import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { DevFlags } from './types.ts'

const execFileAsync = promisify(execFile)
const CODEX_HOOKS_PATH = '.codex/hooks.json'

export interface DdevPaths {
  repoRoot: string
  homeDir: string
  runtimeRoot: string
  repoId: string
  repoStateContainer: string
  repoStateRoot: string
  legacyGlobalRepoStateRoot: string | null
  legacyRepoStateRoot: string
  configPath: string
  codexHooksPath: string
  checkoutPointerPath: string
}

export async function resolveDdevPaths(flags: DevFlags): Promise<DdevPaths> {
  const repoRoot = resolve(flags.repoRoot ?? process.cwd())
  const homeDir = flags.homeDir ?? homedir()
  const runtimeRoot = join(homeDir, '.deweyou', 'dev')
  const identity = await repoIdentity(repoRoot)
  const repoId = repoStateId(identity.name, identity.key)
  const pathRepoId = repoStateId(basename(repoRoot), repoRoot)
  const repoStateContainer = join(runtimeRoot, 'repos')
  const repoStateRoot = join(repoStateContainer, repoId)
  const checkoutId = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16)

  return {
    repoRoot,
    homeDir,
    runtimeRoot,
    repoId,
    repoStateContainer,
    repoStateRoot,
    legacyGlobalRepoStateRoot: pathRepoId === repoId
      ? null
      : join(repoStateContainer, pathRepoId),
    legacyRepoStateRoot: join(repoRoot, '.deweyou', 'dev'),
    configPath: join(runtimeRoot, 'config.json'),
    codexHooksPath: join(homeDir, CODEX_HOOKS_PATH),
    checkoutPointerPath: join(repoStateRoot, 'checkouts', `${checkoutId}.json`),
  }
}

export async function currentBranch(repoRoot: string): Promise<string> {
  return gitOutput(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown')
    .then((branch) => branch === 'HEAD' ? 'detached' : branch)
}

export async function currentHead(repoRoot: string): Promise<string | null> {
  const output = await gitOutput(repoRoot, ['rev-parse', 'HEAD'], '')
  return output || null
}

export function legacySessionPath(repoStateRoot: string, branch: string): string {
  return join(repoStateRoot, 'sessions', legacySessionName(branch))
}

export function legacySessionName(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '__')
}

function repoStateId(nameValue: string, key: string): string {
  const name = nameValue.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 10)
  return `${name}-${hash}`
}

async function repoIdentity(repoRoot: string): Promise<{ name: string, key: string }> {
  const remote = await gitOutput(repoRoot, ['config', '--get', 'remote.origin.url'], '')
  if (remote) {
    const normalized = normalizeRemote(remote)
    return {
      name: basename(normalized).replace(/\.git$/, '') || basename(repoRoot),
      key: `remote:${normalized}`,
    }
  }

  const commonDir = await gitOutput(repoRoot, ['rev-parse', '--git-common-dir'], '')
  if (commonDir) {
    const absoluteCommonDir = resolve(repoRoot, commonDir)
    if (dirname(absoluteCommonDir) !== repoRoot) {
      return {
        name: basename(dirname(absoluteCommonDir)),
        key: `git-common-dir:${absoluteCommonDir}`,
      }
    }
  }

  return { name: basename(repoRoot), key: repoRoot }
}

function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^git@([^:]+):/, 'ssh://$1/')
    .replace(/^https?:\/\/[^@/]+@/, 'https://')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .toLowerCase()
}

async function gitOutput(repoRoot: string, args: string[], fallback: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args])
    return stdout.trim() || fallback
  } catch {
    return fallback
  }
}
