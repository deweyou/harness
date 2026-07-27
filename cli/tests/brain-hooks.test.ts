import assert from 'node:assert/strict'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import {
  brainHookStatus,
  installBrainHooks,
  runBrainHook,
  uninstallBrainHooks,
} from '../src/cli/brain-hooks.ts'
import { initBrain } from '../src/cli/brain.ts'

describe('brain hook adapters', () => {
  it('installs all adapters while preserving unrelated hooks', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-brain-hooks-'))
    await writeFile(
      join(await ensureDirectory(homeDir, '.codex'), 'hooks.json'),
      `${JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'existing-collector' }],
            },
            'preserve-nonstandard-block',
          ],
          UserPromptSubmit: 'legacy-invalid-shape',
          OtherEvent: { unexpected: true },
        },
      })}\n`,
    )
    await writeFile(
      join(homeDir, '.codex', 'config.toml'),
      `model = "gpt-5"

[features]
web_search = true
codex_hooks = false

[history]
persistence = "save-all"
`,
    )

    const installed = await installBrainHooks({ homeDir, agent: 'all' })
    assert.equal(installed.statuses.length, 5)
    assert.ok(
      installed.statuses
        .filter((status) => status.agent !== 'openclaw')
        .every((status) => status.installed),
    )

    const codex = JSON.parse(
      await readFile(join(homeDir, '.codex/hooks.json'), 'utf8'),
    )
    assert.match(JSON.stringify(codex), /existing-collector/)
    assert.match(JSON.stringify(codex), /preserve-nonstandard-block/)
    assert.match(JSON.stringify(codex), /brain hook run --agent codex/)
    const codexConfig = await readFile(
      join(homeDir, '.codex/config.toml'),
      'utf8',
    )
    assert.match(codexConfig, /\[features\]/)
    assert.match(codexConfig, /hooks = true/)
    assert.match(codexConfig, /web_search = true/)
    assert.doesNotMatch(codexConfig, /codex_hooks/)
    assert.match(codexConfig, /\[history\]/)
    assert.match(
      await readFile(join(homeDir, '.hermes/config.yaml'), 'utf8'),
      /pre_llm_call/,
    )
    assert.match(
      await readFile(
        join(homeDir, '.deweyou/brain/adapters/openclaw/index.mjs'),
        'utf8',
      ),
      /before_prompt_build/,
    )
    assert.match(
      await readFile(
        join(homeDir, '.deweyou/brain/adapters/openclaw/index.mjs'),
        'utf8',
      ),
      /child\.kill\(\)/,
    )
    const hermesConfig = await readFile(
      join(homeDir, '.hermes/config.yaml'),
      'utf8',
    )
    assert.equal(
      hermesConfig.match(/deweyou-brain\.py/g)?.length,
      4,
    )
    assert.match(
      await readFile(join(homeDir, '.trae/hooks.json'), 'utf8'),
      /brain hook run --agent trae/,
    )
  })

  it('uninstalls only Deweyou-owned hook entries', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-brain-unhook-'))
    await installBrainHooks({ homeDir, agent: 'all' })
    const codexPath = join(homeDir, '.codex/hooks.json')
    const codex = JSON.parse(await readFile(codexPath, 'utf8'))
    codex.hooks.Stop.push({
      matcher: '*',
      hooks: [{ type: 'command', command: 'keep-me' }],
    })
    await writeFile(codexPath, `${JSON.stringify(codex)}\n`)

    await uninstallBrainHooks({ homeDir, agent: 'all' })
    const status = await brainHookStatus({ homeDir, agent: 'all' })
    assert.ok(status.every((entry) => !entry.installed))
    assert.match(await readFile(codexPath, 'utf8'), /keep-me/)
    assert.doesNotMatch(await readFile(codexPath, 'utf8'), /deweyou-cli brain hook run/)
    await assert.rejects(
      access(join(homeDir, '.deweyou/brain/adapters/openclaw/index.mjs')),
    )
  })

  it('supports side-effect-free dry runs', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-brain-hook-plan-'))
    const result = await installBrainHooks({
      homeDir,
      agent: 'hermes',
      dryRun: true,
    })
    assert.equal(result.dryRun, true)
    await assert.rejects(access(join(homeDir, '.hermes/config.yaml')))
  })

  it('installs Trae hooks into an explicit project repository', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-trae-home-'))
    const repo = join(homeDir, 'project')
    const installed = await installBrainHooks({
      homeDir,
      repo,
      agent: 'trae',
    })
    assert.equal(installed.statuses[0].installed, true)
    const projectHooks = join(repo, '.trae', 'hooks.json')
    assert.match(await readFile(projectHooks, 'utf8'), /--agent trae/)
    await assert.rejects(access(join(homeDir, '.trae', 'hooks.json')))
    assert.equal(
      (await brainHookStatus({ homeDir, repo, agent: 'trae' }))[0].installed,
      true,
    )
    await uninstallBrainHooks({ homeDir, repo, agent: 'trae' })
    assert.equal(
      (await brainHookStatus({ homeDir, repo, agent: 'trae' }))[0].installed,
      false,
    )
  })

  it('activates and removes the OpenClaw plugin through its native CLI', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-openclaw-home-'))
    const binDir = await ensureDirectory(homeDir, 'bin')
    const logPath = join(homeDir, 'openclaw-calls.log')
    const executable = join(binDir, 'openclaw')
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$OPENCLAW_TEST_LOG"
if [ "$1" = "--version" ]; then
  printf '%s\\n' "openclaw-test"
fi
`,
    )
    await chmod(executable, 0o700)

    const previous = {
      home: process.env.HOME,
      path: process.env.PATH,
      log: process.env.OPENCLAW_TEST_LOG,
    }
    process.env.HOME = homeDir
    process.env.PATH = `${binDir}:${previous.path ?? ''}`
    process.env.OPENCLAW_TEST_LOG = logPath
    try {
      const installed = await installBrainHooks({ agent: 'openclaw' })
      assert.equal(installed.statuses[0].installed, true)
      assert.match(await readFile(logPath, 'utf8'), /plugins install --link/)
      assert.match(await readFile(logPath, 'utf8'), /plugins enable deweyou-brain/)
      assert.match(
        await readFile(logPath, 'utf8'),
        /config set plugins\.entries\.deweyou-brain\.hooks\.allowConversationAccess true --strict-json/,
      )

      await uninstallBrainHooks({ agent: 'openclaw' })
      assert.match(
        await readFile(logPath, 'utf8'),
        /plugins uninstall deweyou-brain --force/,
      )
    } finally {
      restoreEnvironment('HOME', previous.home)
      restoreEnvironment('PATH', previous.path)
      restoreEnvironment('OPENCLAW_TEST_LOG', previous.log)
    }
  })

  it('surfaces each OpenClaw activation failure without claiming installation', async () => {
    for (const scenario of [
      { match: 'plugins install', message: /plugin install failed/ },
      { match: 'plugins enable', message: /plugin enable failed/ },
      { match: 'config set', message: /conversation access configuration failed/ },
    ]) {
      const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-openclaw-fail-'))
      const binDir = await ensureDirectory(homeDir, 'bin')
      const executable = join(binDir, 'openclaw')
      await writeFile(
        executable,
        `#!/bin/sh
if [ "$*" = "$OPENCLAW_FAIL_MATCH" ] || printf '%s' "$*" | grep -F "$OPENCLAW_FAIL_MATCH" >/dev/null; then
  printf '%s\\n' "simulated failure" >&2
  exit 1
fi
printf '%s\\n' "ok"
`,
      )
      await chmod(executable, 0o700)

      const previous = {
        home: process.env.HOME,
        path: process.env.PATH,
        failure: process.env.OPENCLAW_FAIL_MATCH,
      }
      process.env.HOME = homeDir
      process.env.PATH = `${binDir}:${previous.path ?? ''}`
      process.env.OPENCLAW_FAIL_MATCH = scenario.match
      try {
        await assert.rejects(
          installBrainHooks({ agent: 'openclaw' }),
          scenario.message,
        )
      } finally {
        restoreEnvironment('HOME', previous.home)
        restoreEnvironment('PATH', previous.path)
        restoreEnvironment('OPENCLAW_FAIL_MATCH', previous.failure)
      }
    }
  })

  it('captures fail-open events and injects scoped context on prompt hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-hook-runtime-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      join(repoPath, 'claims', 'preference.md'),
      `---
id: hook-preference
type: claim
title: Hook preference
classification: private
scope: [personal]
status: active
authority: user
confidence: 1
---

Prefer deterministic context injection.
`,
    )

    const context = await runBrainHook({
      homeDir,
      agent: 'claude',
      event: 'UserPromptSubmit',
      data: JSON.stringify({
        prompt: 'deterministic context injection',
        cwd: '/tmp/project',
      }),
    })
    assert.match(JSON.stringify(context), /Hook preference/)
    assert.deepEqual(
      await runBrainHook({
        homeDir,
        agent: 'claude',
        event: 'Stop',
        data: 'plain text payload',
      }),
      {},
    )
    assert.deepEqual(
      await runBrainHook({
        homeDir,
        agent: 'trae',
        event: 'Stop',
        data: '[]',
      }),
      {},
    )
    assert.match(
      JSON.stringify(await runBrainHook({
        homeDir,
        agent: 'codex',
        event: 'SessionStart',
        data: '{}',
      })),
      /Personal domain/,
    )
    assert.deepEqual(
      await runBrainHook({
        homeDir: join(root, 'not-initialized'),
        agent: 'codex',
        event: 'SessionStart',
      }),
      {},
    )
  })

  it('validates adapter selection and reports incomplete installations', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'deweyou-brain-hook-invalid-'))
    await assert.rejects(
      brainHookStatus({ homeDir, agent: 'invalid' as never }),
      /must be one of/,
    )
    const before = await brainHookStatus({ homeDir, agent: 'all' })
    assert.ok(before.every((entry) => !entry.installed))
    await writeFile(join(await ensureDirectory(homeDir, '.codex'), 'hooks.json'), '[]')
    assert.equal(
      (await brainHookStatus({ homeDir, agent: 'codex' }))[0].installed,
      false,
    )
    const removal = await uninstallBrainHooks({
      homeDir,
      agent: 'openclaw',
      dryRun: true,
    })
    assert.equal(removal.statuses[0].detail, 'planned removal')
  })
})

async function ensureDirectory(root: string, name: string): Promise<string> {
  const path = join(root, name)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path, { recursive: true })
  return path
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
