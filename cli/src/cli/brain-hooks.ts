import { execFile } from 'node:child_process'
import { copyFile, chmod, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import yaml from 'js-yaml'

import { loadBrainConfig } from './brain-config.ts'
import { captureBrainEvent } from './brain.ts'
import { indexBrain } from './brain-index.ts'
import { recallBrain } from './brain-recall.ts'
import {
  BRAIN_AGENTS,
  type BrainAgent,
  type BrainHookFlags,
  type BrainHookResult,
  type BrainHookStatus,
} from './brain-types.ts'
import { writeFileAtomic, writeJsonAtomic } from './safe-io.ts'

const { load: loadYaml, dump: dumpYaml, JSON_SCHEMA } = yaml
const execFileAsync = promisify(execFile)
const MANAGED_MARKER = 'deweyou-cli brain hook run'
const JSON_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop'] as const

export async function installBrainHooks(
  flags: BrainHookFlags = {},
): Promise<BrainHookResult> {
  const agents = selectedAgents(flags.agent)
  if (flags.dryRun) {
    return {
      operation: 'install',
      dryRun: true,
      statuses: agents.map((agent) => ({
        agent,
        installed: false,
        paths: adapterPaths(agent, flags.homeDir, flags.repo),
        detail: 'planned',
      })),
    }
  }

  for (const agent of agents) {
    if (agent === 'codex' || agent === 'claude' || agent === 'trae') {
      await installJsonHooks(agent, flags.homeDir, flags.repo)
    }
    if (agent === 'hermes') await installHermesHooks(flags.homeDir)
    if (agent === 'openclaw') await installOpenClawPlugin(flags.homeDir)
  }
  return {
    operation: 'install',
    dryRun: false,
    statuses: await brainHookStatus({ ...flags, agent: flags.agent }),
  }
}

export async function uninstallBrainHooks(
  flags: BrainHookFlags = {},
): Promise<BrainHookResult> {
  const agents = selectedAgents(flags.agent)
  if (flags.dryRun) {
    return {
      operation: 'uninstall',
      dryRun: true,
      statuses: agents.map((agent) => ({
        agent,
        installed: true,
        paths: adapterPaths(agent, flags.homeDir),
        detail: 'planned removal',
      })),
    }
  }

  for (const agent of agents) {
    if (agent === 'codex' || agent === 'claude' || agent === 'trae') {
      await uninstallJsonHooks(agent, flags.homeDir, flags.repo)
    }
    if (agent === 'hermes') await uninstallHermesHooks(flags.homeDir)
    if (agent === 'openclaw') await uninstallOpenClawPlugin(flags.homeDir)
  }
  return {
    operation: 'uninstall',
    dryRun: false,
    statuses: await brainHookStatus({ ...flags, agent: flags.agent }),
  }
}

export async function brainHookStatus(
  flags: BrainHookFlags = {},
): Promise<BrainHookStatus[]> {
  const result: BrainHookStatus[] = []
  for (const agent of selectedAgents(flags.agent)) {
    if (agent === 'codex' || agent === 'claude' || agent === 'trae') {
      const path = jsonHookPath(agent, flags.homeDir, flags.repo)
      const config = await readJsonObject(path)
      const enabled = agent === 'codex'
        ? await codexHooksEnabled(flags.homeDir)
        : true
      result.push({
        agent,
        installed:
          countManagedJsonHooks(config, agent) === JSON_HOOK_EVENTS.length &&
          enabled,
        paths: adapterPaths(agent, flags.homeDir, flags.repo),
        detail:
          `${countManagedJsonHooks(config, agent)}/${JSON_HOOK_EVENTS.length} lifecycle hooks` +
          (agent === 'codex'
            ? `; Codex hooks feature ${enabled ? 'enabled' : 'disabled'}`
            : ''),
      })
    }
    if (agent === 'hermes') {
      const [configPath, scriptPath] = adapterPaths(agent, flags.homeDir)
      const config = await readYamlObject(configPath)
      const installed =
        await exists(scriptPath) &&
        hermesManagedEntries(config, scriptPath) === 4
      result.push({
        agent,
        installed,
        paths: [configPath, scriptPath],
        detail: installed
          ? 'on_session_start, pre_llm_call, post_llm_call, on_session_end'
          : 'Hermes shell hooks are incomplete',
      })
    }
    if (agent === 'openclaw') {
      const paths = adapterPaths(agent, flags.homeDir)
      const sourcePaths = paths.slice(0, 3)
      const sourceReady = (await Promise.all(sourcePaths.map(exists))).every(Boolean)
      const installed = sourceReady && await exists(paths[3])
      result.push({
        agent,
        installed,
        paths,
        detail: installed
          ? 'OpenClaw plugin registration completed; restart and inspect the Gateway runtime'
          : sourceReady
            ? 'Plugin files are ready; OpenClaw CLI activation is pending'
            : 'OpenClaw plugin source is incomplete',
      })
    }
  }
  return result
}

export async function runBrainHook(
  flags: BrainHookFlags & { agent: BrainAgent; event: string },
): Promise<Record<string, unknown>> {
  const payload = parseHookPayload(flags.data)
  try {
    await captureBrainEvent({
      homeDir: flags.homeDir,
      agent: flags.agent,
      eventType: normalizeEventType(flags.event),
      sessionId: stringValue(payload.session_id),
      cwd: stringValue(payload.cwd),
      payload,
    })
    if (!isContextEvent(flags.event)) return {}
    await indexBrain({ homeDir: flags.homeDir })
    const config = await loadBrainConfig({ homeDir: flags.homeDir })
    const context = await recallBrain({
      homeDir: flags.homeDir,
      query: hookQuery(payload),
      allowedScopes: [
        ...config.defaults.scopes,
        `device/${config.device_id}`,
      ],
    })
    const markdown = renderHookContext(context)
    return {
      additionalContext: markdown,
      hookSpecificOutput: {
        hookEventName: flags.event,
        additionalContext: markdown,
      },
    }
  } catch {
    return {}
  }
}

async function installJsonHooks(
  agent: 'codex' | 'claude' | 'trae',
  homeDir = defaultHome(),
  repo?: string,
): Promise<void> {
  const path = jsonHookPath(agent, homeDir, repo)
  const config = await readJsonObject(path)
  const hooks = isRecord(config.hooks) ? config.hooks : {}
  config.hooks = hooks
  if (agent === 'trae' && config.version === undefined) config.version = 1

  for (const event of JSON_HOOK_EVENTS) {
    const blocks = Array.isArray(hooks[event]) ? hooks[event] : []
    const filtered = removeManagedBlocks(blocks, agent)
    filtered.push({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: hookCommand(agent, event),
          timeout: 10,
        },
      ],
    })
    hooks[event] = filtered
  }
  await backupIfPresent(path)
  await writeJsonAtomic(path, config)
  if (agent === 'codex') await enableCodexHooks(homeDir)
}

async function uninstallJsonHooks(
  agent: 'codex' | 'claude' | 'trae',
  homeDir = defaultHome(),
  repo?: string,
): Promise<void> {
  const path = jsonHookPath(agent, homeDir, repo)
  const config = await readJsonObject(path)
  if (!isRecord(config.hooks)) return
  for (const [event, blocks] of Object.entries(config.hooks)) {
    if (!Array.isArray(blocks)) continue
    const filtered = removeManagedBlocks(blocks, agent)
    if (filtered.length === 0) delete config.hooks[event]
    else config.hooks[event] = filtered
  }
  await backupIfPresent(path)
  await writeJsonAtomic(path, config)
}

async function enableCodexHooks(homeDir = defaultHome()): Promise<void> {
  const path = adapterPaths('codex', homeDir)[1]
  const current = await readTextOrEmpty(path)
  const next = setCodexHooksFeature(current)
  if (next === current) return
  await backupIfPresent(path)
  await writeFileAtomic(path, next)
}

async function codexHooksEnabled(homeDir = defaultHome()): Promise<boolean> {
  const content = await readTextOrEmpty(adapterPaths('codex', homeDir)[1])
  const section = tomlSection(content, 'features')
  if (!section) return false
  const hooks = tomlBoolean(section, 'hooks')
  return hooks ?? tomlBoolean(section, 'codex_hooks') ?? false
}

function setCodexHooksFeature(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const range = tomlSectionRange(lines, 'features')
  if (!range) {
    const prefix = content.trimEnd()
    return `${prefix}${prefix ? '\n\n' : ''}[features]\nhooks = true\n`
  }
  const section = lines.slice(range.start + 1, range.end)
  const updated: string[] = []
  let written = false
  for (const line of section) {
    const match = line.match(/^(\s*)(hooks|codex_hooks)\s*=/)
    if (!match) {
      updated.push(line)
      continue
    }
    if (!written) {
      updated.push(`${match[1]}hooks = true`)
      written = true
    }
  }
  if (!written) updated.unshift('hooks = true')
  lines.splice(range.start + 1, section.length, ...updated)
  return `${lines.join('\n').replace(/\n*$/, '')}\n`
}

function tomlSection(content: string, name: string): string | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const range = tomlSectionRange(lines, name)
  return range ? lines.slice(range.start + 1, range.end).join('\n') : null
}

function tomlSectionRange(
  lines: string[],
  name: string,
): { start: number; end: number } | null {
  const sectionPattern = new RegExp(
    `^\\s*\\[${name}\\]\\s*(?:#.*)?$`,
  )
  const start = lines.findIndex((line) => sectionPattern.test(line))
  if (start === -1) return null
  const next = lines.findIndex(
    (line, index) => index > start && /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line),
  )
  return { start, end: next === -1 ? lines.length : next }
}

function tomlBoolean(section: string, key: string): boolean | null {
  const match = section.match(
    new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, 'm'),
  )
  return match ? match[1] === 'true' : null
}

async function installHermesHooks(homeDir = defaultHome()): Promise<void> {
  const [configPath, scriptPath] = adapterPaths('hermes', homeDir)
  await writeFileAtomic(scriptPath, hermesScript())
  await chmod(scriptPath, 0o700)
  const config = await readYamlObject(configPath)
  const hooks = isRecord(config.hooks) ? config.hooks : {}
  config.hooks = hooks
  for (const event of [
    'on_session_start',
    'pre_llm_call',
    'post_llm_call',
    'on_session_end',
  ]) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : []
    hooks[event] = [
      ...entries.filter(
        (entry) => !isRecord(entry) || entry.command !== scriptPath,
      ),
      { command: scriptPath, timeout: 10 },
    ]
  }
  await backupIfPresent(configPath)
  await writeFileAtomic(
    configPath,
    dumpYaml(config, { noRefs: true, lineWidth: 100 }),
  )
}

async function uninstallHermesHooks(homeDir = defaultHome()): Promise<void> {
  const [configPath, scriptPath] = adapterPaths('hermes', homeDir)
  const config = await readYamlObject(configPath)
  if (isRecord(config.hooks)) {
    for (const [event, entries] of Object.entries(config.hooks)) {
      if (!Array.isArray(entries)) continue
      const filtered = entries.filter(
        (entry) => !isRecord(entry) || entry.command !== scriptPath,
      )
      if (filtered.length === 0) delete config.hooks[event]
      else config.hooks[event] = filtered
    }
    await backupIfPresent(configPath)
    await writeFileAtomic(
      configPath,
      dumpYaml(config, { noRefs: true, lineWidth: 100 }),
    )
  }
  await rm(scriptPath, { force: true })
}

async function installOpenClawPlugin(homeDir = defaultHome()): Promise<void> {
  const [packagePath, manifestPath, entryPath, activationPath] =
    adapterPaths('openclaw', homeDir)
  await writeFileAtomic(
    packagePath,
    `${JSON.stringify(
      {
        name: '@deweyou/openclaw-brain',
        version: '1.0.0',
        type: 'module',
        openclaw: { extensions: ['./index.mjs'] },
      },
      null,
      2,
    )}\n`,
  )
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify(
      {
        id: 'deweyou-brain',
        name: 'Deweyou Brain',
        description: 'Captures OpenClaw lifecycle events and injects scoped Context Packs.',
        activation: { onStartup: true },
        configSchema: { type: 'object', additionalProperties: false },
      },
      null,
      2,
    )}\n`,
  )
  await writeFileAtomic(entryPath, openClawPlugin())
  if (homeDir !== defaultHome() || !await commandAvailable('openclaw')) return
  const sourceRoot = dirname(packagePath)
  const installed = await commandResult('openclaw', [
    'plugins',
    'install',
    '--link',
    sourceRoot,
    '--force',
  ], openClawEnvironment(homeDir))
  if (!installed.ok) {
    throw new Error(`OpenClaw plugin install failed: ${installed.stderr}`)
  }
  const enabled = await commandResult('openclaw', [
    'plugins',
    'enable',
    'deweyou-brain',
  ], openClawEnvironment(homeDir))
  if (!enabled.ok) {
    throw new Error(`OpenClaw plugin enable failed: ${enabled.stderr}`)
  }
  const conversationAccess = await commandResult('openclaw', [
    'config',
    'set',
    'plugins.entries.deweyou-brain.hooks.allowConversationAccess',
    'true',
    '--strict-json',
  ], openClawEnvironment(homeDir))
  if (!conversationAccess.ok) {
    throw new Error(
      `OpenClaw conversation access configuration failed: ${conversationAccess.stderr}`,
    )
  }
  await writeJsonAtomic(activationPath, {
    schema_version: 1,
    plugin_id: 'deweyou-brain',
    source_root: sourceRoot,
    activated_at: new Date().toISOString(),
  })
}

async function uninstallOpenClawPlugin(homeDir = defaultHome()): Promise<void> {
  const [packagePath] = adapterPaths('openclaw', homeDir)
  if (homeDir === defaultHome() && await commandAvailable('openclaw')) {
    await commandResult('openclaw', [
      'plugins',
      'uninstall',
      'deweyou-brain',
      '--force',
    ], openClawEnvironment(homeDir))
  }
  await rm(dirname(packagePath), { recursive: true, force: true })
}

function selectedAgents(agent: BrainHookFlags['agent']): BrainAgent[] {
  if (!agent || agent === 'all') return [...BRAIN_AGENTS]
  if (!BRAIN_AGENTS.includes(agent)) {
    throw new Error(`Brain hook agent must be one of all, ${BRAIN_AGENTS.join(', ')}`)
  }
  return [agent]
}

function adapterPaths(
  agent: BrainAgent,
  homeDir = defaultHome(),
  repo?: string,
): string[] {
  if (agent === 'codex') {
    return [
      join(homeDir, '.codex', 'hooks.json'),
      join(homeDir, '.codex', 'config.toml'),
    ]
  }
  if (agent === 'claude') return [join(homeDir, '.claude', 'settings.json')]
  if (agent === 'trae') {
    return [
      repo
        ? join(resolve(repo), '.trae', 'hooks.json')
        : join(homeDir, '.trae', 'hooks.json'),
    ]
  }
  if (agent === 'hermes') {
    return [
      join(homeDir, '.hermes', 'config.yaml'),
      join(homeDir, '.hermes', 'agent-hooks', 'deweyou-brain.py'),
    ]
  }
  const root = join(homeDir, '.deweyou', 'brain', 'adapters', 'openclaw')
  return [
    join(root, 'package.json'),
    join(root, 'openclaw.plugin.json'),
    join(root, 'index.mjs'),
    join(root, 'activation.json'),
  ]
}

function jsonHookPath(
  agent: 'codex' | 'claude' | 'trae',
  homeDir = defaultHome(),
  repo?: string,
): string {
  return adapterPaths(agent, homeDir, repo)[0]
}

function hookCommand(agent: BrainAgent, event: string): string {
  return `deweyou-cli brain hook run --agent ${agent} --event ${event}`
}

function removeManagedBlocks(blocks: unknown[], agent: BrainAgent): unknown[] {
  return blocks
    .map((block) => {
      if (!isRecord(block) || !Array.isArray(block.hooks)) return block
      const hooks = block.hooks.filter((hook) => !isManagedHook(hook, agent))
      return hooks.length > 0 ? { ...block, hooks } : null
    })
    .filter((block) => block !== null)
}

function isManagedHook(value: unknown, agent: BrainAgent): boolean {
  return (
    isRecord(value) &&
    typeof value.command === 'string' &&
    value.command.includes(MANAGED_MARKER) &&
    value.command.includes(`--agent ${agent}`)
  )
}

function countManagedJsonHooks(
  config: Record<string, unknown>,
  agent: BrainAgent,
): number {
  if (!isRecord(config.hooks)) return 0
  const hooks = config.hooks
  return JSON_HOOK_EVENTS.filter((event) => {
    const blocks = hooks[event]
    return (
      Array.isArray(blocks) &&
      blocks.some(
        (block) =>
          isRecord(block) &&
          Array.isArray(block.hooks) &&
          block.hooks.some((hook) => isManagedHook(hook, agent)),
      )
    )
  }).length
}

function hermesManagedEntries(
  config: Record<string, unknown>,
  scriptPath: string,
): number {
  if (!isRecord(config.hooks)) return 0
  return Object.values(config.hooks).filter(
    (entries) =>
      Array.isArray(entries) &&
      entries.some((entry) => isRecord(entry) && entry.command === scriptPath),
  ).length
}

function parseHookPayload(data: string | undefined): Record<string, unknown> {
  if (!data?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(data)
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { raw: data }
  }
}

function normalizeEventType(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

function isContextEvent(value: string): boolean {
  return value === 'SessionStart' || value === 'UserPromptSubmit'
}

function hookQuery(payload: Record<string, unknown>): string {
  for (const key of ['prompt', 'user_prompt', 'user_message', 'message']) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key]
  }
  return 'current project preferences decisions'
}

function renderHookContext(context: Awaited<ReturnType<typeof recallBrain>>): string {
  if (context.entries.length === 0) return ''
  return `# Deweyou Context Pack

${context.entries
  .map(
    (entry) => `## ${entry.title}

${entry.content}

_Source: ${entry.id}; classification: ${entry.classification}; status: ${entry.status}._`,
  )
  .join('\n\n')}
`
}

function hermesScript(): string {
  return `#!/usr/bin/env python3
import json
import subprocess
import sys

def run(args, payload=None):
    try:
        return subprocess.run(
            ["deweyou-cli", *args],
            input=None if payload is None else json.dumps(payload),
            text=True,
            capture_output=True,
            timeout=4,
            check=False,
        )
    except Exception:
        return None

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    event = str(payload.get("hook_event_name", "event")).replace("_", "-")
    run(["brain", "capture", "--agent", "hermes", "--event", event], payload)
    if payload.get("hook_event_name") == "pre_llm_call":
        extra = payload.get("extra") or {}
        query = str(extra.get("user_message", "current context"))
        recalled = run(["brain", "recall", "--query", query, "--format", "markdown"])
        context = recalled.stdout if recalled and recalled.returncode == 0 else ""
        sys.stdout.write(json.dumps({"context": context}) + "\\n")
    else:
        sys.stdout.write("{}\\n")

if __name__ == "__main__":
    main()
`
}

function openClawPlugin(): string {
  return `import { spawn } from "node:child_process";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

function cli(args, payload, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const child = spawn("deweyou-cli", args, { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish("");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", () => finish(""));
    child.on("close", () => finish(output));
    child.stdin.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}

function capture(event, payload) {
  void cli(["brain", "capture", "--agent", "openclaw", "--event", event], payload);
}

export default definePluginEntry({
  id: "deweyou-brain",
  name: "Deweyou Brain",
  description: "Cross-agent personal Context Hub adapter.",
  register(api) {
    api.on("before_prompt_build", async (event) => {
      capture("before-prompt-build", event);
      const query = String(event?.prompt ?? "current context");
      const context = await cli(["brain", "recall", "--query", query, "--format", "markdown"]);
      return context ? { prependContext: context } : undefined;
    });
    api.on("agent_end", async (event) => capture("agent-end", event));
    api.on("session_start", async (event) => capture("session-start", event));
    api.on("session_end", async (event) => capture("session-end", event));
  },
});
`
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return {}
    /* v8 ignore next -- malformed JSON and I/O failures must surface. */
    throw error
  }
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return ''
    throw error
  }
}

async function readYamlObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = loadYaml(await readFile(path, 'utf8'), { schema: JSON_SCHEMA })
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return {}
    /* v8 ignore next -- malformed YAML and I/O failures must surface. */
    throw error
  }
}

async function backupIfPresent(path: string): Promise<void> {
  if (!await exists(path)) return
  await mkdir(dirname(path), { recursive: true })
  await copyFile(path, `${path}.deweyou-brain.bak`)
}

async function commandAvailable(file: string): Promise<boolean> {
  return (await commandResult(file, ['--version'])).ok
}

async function commandResult(
  file: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      env: { ...process.env, ...env },
    })
    return { ok: true, stdout, stderr }
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      return {
        ok: false,
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? error.message),
      }
    }
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

function openClawEnvironment(homeDir: string): NodeJS.ProcessEnv {
  return {
    OPENCLAW_HOME: homeDir,
    OPENCLAW_STATE_DIR: join(homeDir, '.openclaw'),
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false
    /* v8 ignore next -- unexpected stat errors must surface unchanged. */
    throw error
  }
}

function defaultHome(): string {
  return homedir()
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasCode(error: unknown, code: string): boolean {
  /* v8 ignore next -- defensive handling for non-Node filesystem throws. */
  return error instanceof Error && 'code' in error && error.code === code
}
