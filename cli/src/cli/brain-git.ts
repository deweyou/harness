import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { loadBrainConfig } from './brain-config.ts'
import { compileWiki } from './brain-wiki.ts'

const execFileAsync = promisify(execFile)
const DURABLE_PATHS = [
  '.gitignore',
  'AGENTS.md',
  'brain.yaml',
  'schemas',
  'policy',
  'devices',
  'events',
  'sources',
  'observations',
  'claims',
  'resolutions',
  'decisions',
  'wiki',
]

export interface BrainSyncResult {
  status: 'local-only' | 'up-to-date' | 'pushed'
  commitsCreated: number
  retries: number
  remote: string
  branch: string
}

export async function syncBrain({
  homeDir,
  maxRetries = 3,
  now = new Date(),
  beforePush,
}: {
  homeDir?: string
  maxRetries?: number
  now?: Date
  beforePush?: (attempt: number) => Promise<void>
} = {}): Promise<BrainSyncResult> {
  const config = await loadBrainConfig({ homeDir })
  const repoRoot = config.knowledge_repo
  await assertGitRepository(repoRoot)
  const remote = config.sync.remote
  const branch = config.sync.branch
  let commitsCreated = 0

  await stageDurablePaths(repoRoot)
  await assertNoStagedSecrets(repoRoot)
  if (await hasStagedChanges(repoRoot)) {
    await commit(repoRoot, `brain(${config.device_id}): capture ${now.toISOString()}`)
    commitsCreated += 1
  }

  if (!config.sync.enabled || !await hasRemote(repoRoot, remote)) {
    return {
      status: commitsCreated > 0 ? 'local-only' : 'up-to-date',
      commitsCreated,
      retries: 0,
      remote,
      branch,
    }
  }

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (await remoteBranchExists(repoRoot, remote, branch)) {
      await git(repoRoot, ['fetch', '--prune', remote, branch])
      await rebaseWithGeneratedArtifactRecovery(repoRoot, `${remote}/${branch}`)
    }

    await compileWiki({ homeDir })
    await stageDurablePaths(repoRoot)
    await assertNoStagedSecrets(repoRoot)
    if (await hasStagedChanges(repoRoot)) {
      await commit(repoRoot, `brain(${config.device_id}): compile wiki`)
      commitsCreated += 1
    }

    await beforePush?.(attempt)
    const push = await gitResult(repoRoot, [
      'push',
      '--set-upstream',
      remote,
      `HEAD:${branch}`,
    ])
    if (push.ok) {
      return {
        status: commitsCreated > 0 ? 'pushed' : 'up-to-date',
        commitsCreated,
        retries: attempt,
        remote,
        branch,
      }
    }
    if (!isPushRace(push.stderr) || attempt === maxRetries - 1) {
      throw new Error(`Brain push failed: ${push.stderr.trim() || 'unknown error'}`)
    }
  }

  throw new Error('Brain sync retry limit reached')
}

async function rebaseWithGeneratedArtifactRecovery(
  repoRoot: string,
  upstream: string,
): Promise<void> {
  const result = await gitResult(repoRoot, ['rebase', upstream])
  if (result.ok) return
  const conflicts = (
    await git(repoRoot, ['diff', '--name-only', '--diff-filter=U'])
  )
    .split(/\r?\n/)
    .filter(Boolean)
  if (
    conflicts.length === 0 ||
    conflicts.some((path) => !isRecoverableGeneratedPath(path))
  ) {
    await gitResult(repoRoot, ['rebase', '--abort'])
    throw new Error(
      `Brain rebase has canonical conflicts: ${conflicts.join(', ') || result.stderr.trim()}`,
    )
  }

  for (const path of conflicts) {
    if (isResolutionJobPath(path)) {
      await selectCanonicalResolution(repoRoot, path)
    } else {
      await git(repoRoot, ['checkout', '--ours', '--', path])
    }
    await git(repoRoot, ['add', '--', path])
  }
  const continued = await gitResult(repoRoot, ['rebase', '--continue'], {
    GIT_EDITOR: 'true',
  })
  if (!continued.ok) {
    await gitResult(repoRoot, ['rebase', '--abort'])
    throw new Error(`Brain generated-Wiki rebase recovery failed: ${continued.stderr}`)
  }
}

function isRecoverableGeneratedPath(path: string): boolean {
  return (
    path === 'wiki/index.md' ||
    path.startsWith('wiki/domains/') ||
    isResolutionJobPath(path)
  )
}

function isResolutionJobPath(path: string): boolean {
  return (
    path.startsWith('resolutions/jobs/') &&
    path.endsWith('.json') &&
    !path.slice('resolutions/jobs/'.length).includes('/')
  )
}

async function selectCanonicalResolution(
  repoRoot: string,
  path: string,
): Promise<void> {
  const ours = parseResolutionCandidate(
    await git(repoRoot, ['show', `:2:${path}`]),
    path,
  )
  const theirs = parseResolutionCandidate(
    await git(repoRoot, ['show', `:3:${path}`]),
    path,
  )
  const side = ours.selected_proposal.localeCompare(theirs.selected_proposal) <= 0
    ? '--ours'
    : '--theirs'
  await git(repoRoot, ['checkout', side, '--', path])
}

function parseResolutionCandidate(
  content: string,
  path: string,
): { selected_proposal: string } {
  try {
    const parsed: unknown = JSON.parse(content)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'selected_proposal' in parsed &&
      typeof parsed.selected_proposal === 'string' &&
      parsed.selected_proposal.startsWith('resolutions/proposals/')
    ) {
      return { selected_proposal: parsed.selected_proposal }
    }
  } catch {
    // Report the same bounded conflict error below.
  }
  throw new Error(`Brain generated resolution conflict is invalid: ${path}`)
}

async function stageDurablePaths(repoRoot: string): Promise<void> {
  await git(repoRoot, ['add', '--', ...DURABLE_PATHS])
}

async function assertNoStagedSecrets(repoRoot: string): Promise<void> {
  const files = (await git(repoRoot, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']))
    .split(/\r?\n/)
    .filter(Boolean)
  const findings: string[] = []
  for (const file of files) {
    if (!isTextArtifact(file)) continue
    let content: string
    try {
      content = await readFile(join(repoRoot, file), 'utf8')
    } catch {
      continue
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      findings.push(`${file}:private-key`)
    }
    if (/\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(content)) {
      findings.push(`${file}:github-token`)
    }
    if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(content)) {
      findings.push(`${file}:api-key`)
    }
  }
  if (findings.length > 0) {
    await git(repoRoot, ['reset', '--', ...files])
    throw new Error(
      `Brain sync refused staged secret-like content: ${findings.join(', ')}`,
    )
  }
}

async function assertGitRepository(repoRoot: string): Promise<void> {
  const result = await gitResult(repoRoot, ['rev-parse', '--is-inside-work-tree'])
  if (!result.ok || result.stdout.trim() !== 'true') {
    throw new Error(`Brain knowledge repository is not a Git work tree: ${repoRoot}`)
  }
}

async function commit(repoRoot: string, message: string): Promise<void> {
  await git(repoRoot, [
    '-c',
    'user.name=Deweyou Brain',
    '-c',
    'user.email=brain@localhost',
    'commit',
    '-m',
    message,
  ])
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  const result = await gitResult(repoRoot, ['diff', '--cached', '--quiet'])
  return !result.ok
}

async function hasRemote(repoRoot: string, remote: string): Promise<boolean> {
  const result = await gitResult(repoRoot, ['remote', 'get-url', remote])
  return result.ok && Boolean(result.stdout.trim())
}

async function remoteBranchExists(
  repoRoot: string,
  remote: string,
  branch: string,
): Promise<boolean> {
  const result = await gitResult(repoRoot, [
    'ls-remote',
    '--exit-code',
    '--heads',
    remote,
    branch,
  ])
  return result.ok
}

function isPushRace(stderr: string): boolean {
  return /non-fast-forward|fetch first|rejected/i.test(stderr)
}

function isTextArtifact(path: string): boolean {
  return /\.(?:md|json|ya?ml|txt)$/i.test(path) || !path.includes('.')
}

async function git(
  repoRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await gitResult(repoRoot, args, env)
  if (!result.ok) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }
  return result.stdout.trim()
}

async function gitResult(
  repoRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', repoRoot, ...args], {
      env: { ...process.env, ...env },
    })
    return { ok: true, stdout, stderr }
  } catch (error) {
    if (
      error instanceof Error &&
      'stdout' in error &&
      'stderr' in error
    ) {
      return {
        ok: false,
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? error.message),
      }
    }
    /* v8 ignore next -- execFile normally reports stdout and stderr on git errors. */
    return { ok: false, stdout: '', stderr: String(error) }
  }
}
