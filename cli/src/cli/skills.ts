import { spawn } from 'node:child_process'

import { usageError } from './args.ts'

const SKILLS_PACKAGE = 'skills@latest'

type SkillsAction = 'add' | 'update' | 'sync' | 'list' | 'remove'

export interface SkillsCommand {
  command: string
  args: string[]
}

/* v8 ignore next 4 -- child-process execution is covered by argument-builder tests. */
export async function runAgentSkills(argv: string[]): Promise<void> {
  const { command, args } = buildSkillsCommand(argv)
  await runCommand(command, args)
}

export function buildSkillsCommand(argv: string[]): SkillsCommand {
  const [action = '', ...rest] = argv
  if (!isSkillsAction(action)) {
    throw usageError(`Unknown agent skills command: ${action || '(missing)'}`)
  }

  return {
    command: 'npx',
    args: ['-y', SKILLS_PACKAGE, ...skillsArgs(action, rest)],
  }
}

export function buildAgentSyncCommand(argv: string[]): SkillsCommand {
  return buildSkillsCommand(['sync', ...argv])
}

export function buildAgentUpgradeCommand(argv: string[]): SkillsCommand {
  return buildSkillsCommand(['update', ...argv])
}

function skillsArgs(action: SkillsAction, argv: string[]): string[] {
  if (action === 'sync') {
    return ['experimental_install', ...parseFlags(action, argv).passthrough]
  }

  const parsed = parseFlags(action, argv)

  if (action === 'add') {
    const [source, ...extraPositionals] = parsed.positionals
    if (!source) throw usageError('agent skills add requires a source')
    if (extraPositionals.length > 0) {
      throw usageError(`Unexpected argument: ${extraPositionals[0]}`)
    }
    return ['add', source, ...parsed.passthrough]
  }

  return [action, ...parsed.positionals, ...parsed.passthrough]
}

function parseFlags(action: SkillsAction, argv: string[]): {
  positionals: string[]
  passthrough: string[]
} {
  const positionals: string[] = []
  const passthrough: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const name = token.slice(2)
    if (!isAllowedFlag(action, name)) {
      throw usageError(`Flag --${name} is not valid for agent skills ${action}`)
    }

    if (name === 'global') {
      passthrough.push('-g')
      continue
    }

    if (name === 'copy' || name === 'yes' || name === 'json') {
      passthrough.push(`--${name}`)
      continue
    }

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw usageError(`Missing value for --${name}`)
    }
    index += 1

    if (name === 'scope') {
      if (value === 'global') {
        passthrough.push('-g')
      } else if (value === 'project' && action === 'update') {
        passthrough.push('-p')
      } else if (value === 'project') {
        // Project scope is the skills CLI default for list/remove.
      } else {
        throw usageError(`Invalid scope: ${value}`)
      }
      continue
    }

    if (name === 'skills') {
      passthrough.push('--skill', ...splitList(value))
      continue
    }

    if (name === 'tools') {
      passthrough.push('--agent', ...tools(value))
      continue
    }
  }

  return { positionals, passthrough }
}

function isAllowedFlag(action: SkillsAction, name: string): boolean {
  const shared = ['global', 'scope', 'yes']
  const byAction: Record<SkillsAction, string[]> = {
    add: ['skills', 'tools', 'global', 'copy', 'yes'],
    update: shared,
    sync: ['yes'],
    list: ['tools', 'global', 'scope', 'json'],
    remove: ['skills', 'tools', 'global', 'scope', 'yes'],
  }

  return byAction[action].includes(name)
}

function tools(value: string): string[] {
  if (value === 'all') return ['*']
  return splitList(value)
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function isSkillsAction(value: string): value is SkillsAction {
  return ['add', 'update', 'sync', 'list', 'remove'].includes(value)
}

/* v8 ignore start -- thin child-process boundary; keep unit tests on command construction. */
async function runCommand(command: string, args: string[]): Promise<void> {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', resolve)
  })

  if (exitCode && exitCode !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed with exit code ${exitCode}`)
    ;(error as Error & { exitCode: number }).exitCode = exitCode
    throw error
  }
}
/* v8 ignore stop */
