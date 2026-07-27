import type {
  DevSessionCommand,
  ParsedArgs,
  ParsedBrainHookArgs,
  ParsedBrainScheduleArgs,
  ParsedDevSessionArgs,
  UnifiedUpdateFlags,
  UsageError,
} from './types.ts'

const BOOLEAN_FLAGS = new Set([
  'all',
  'global',
  'yes',
  'dry-run',
  'force',
  'no-server',
  'cli-only',
  'agents-only',
  'include-archived',
  'no-push',
  'quiet',
  'discover',
])
const UPDATE_BOOLEAN_FLAGS = new Set(['dry-run', 'cli-only', 'agents-only'])
const VALUE_FLAGS = new Set([
  'mode',
  'skills',
  'rules',
  'design',
  'format',
  'scope',
  'tools',
  'rule-wiring',
  'branch',
  'host',
  'port',
  'kind',
  'data',
  'data-file',
  'id',
  'title',
  'repo',
  'device',
  'remote',
  'agent',
  'event',
  'session',
  'cwd',
  'classification',
  'query',
  'clearance',
  'budget',
  'path',
  'output',
  'interval',
  'status',
  'reason',
])
const FLAGS_BY_TOPIC_COMMAND: Record<string, Record<string, Set<string>>> = {
  agent: {
    init: new Set([
      'all',
      'skills',
      'rules',
      'design',
      'mode',
      'global',
      'scope',
      'tools',
      'rule-wiring',
      'yes',
      'dry-run',
      'force',
    ]),
    context: new Set(['format']),
    update: new Set(),
    doctor: new Set(),
  },
  dev: {
    install: new Set(['dry-run']),
    status: new Set(),
    doctor: new Set(),
    clean: new Set(['all', 'branch', 'dry-run', 'force']),
    demo: new Set(['id', 'branch', 'host', 'port', 'no-server', 'dry-run']),
    record: new Set(['id', 'branch', 'kind', 'data', 'data-file']),
    summary: new Set(['id', 'branch', 'format']),
    uninstall: new Set(['dry-run']),
  },
  brain: {
    init: new Set(['repo', 'device', 'remote', 'branch', 'dry-run', 'force']),
    status: new Set(),
    capture: new Set([
      'agent',
      'event',
      'session',
      'cwd',
      'scope',
      'classification',
      'data',
      'data-file',
      'quiet',
    ]),
    import: new Set([
      'agent',
      'path',
      'scope',
      'classification',
      'discover',
      'dry-run',
    ]),
    index: new Set(),
    recall: new Set([
      'query',
      'scope',
      'clearance',
      'budget',
      'format',
      'include-archived',
    ]),
    export: new Set([
      'output',
      'scope',
      'clearance',
      'format',
      'dry-run',
    ]),
    state: new Set(['id', 'status', 'reason']),
    maintain: new Set(),
    sync: new Set(),
    worker: new Set(['no-push']),
  },
}

export function usageError(message: string, { silent = false } = {}): UsageError {
  const error = new Error(message) as UsageError
  error.exitCode = 2
  error.silent = silent
  return error
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [topic, command, ...rest] = argv
  const flags: ParsedArgs['flags'] = {}

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw usageError(`Unexpected argument: ${token}`)

    const name = token.slice(2)
    if (!isKnownFlag(name)) throw usageError(`Unknown flag: --${name}`)
    if (!isAllowedForCommand(topic, command, name)) {
      throw usageError(`Flag --${name} is not valid for ${topic} ${command}`)
    }

    if (BOOLEAN_FLAGS.has(name)) {
      flags[toCamel(name)] = true
      continue
    }

    if (VALUE_FLAGS.has(name)) {
      const value = rest[index + 1]
      if (!value || value.startsWith('--')) throw usageError(`Missing value for --${name}`)
      flags[toCamel(name)] = parseValue(name, value)
      index += 1
      continue
    }
  }

  if (topic === 'agent' && command === 'context' && !flags.format) {
    flags.format = 'markdown'
  }

  return { topic, command, flags }
}

export function parseUpdateArgs(argv: string[]): UnifiedUpdateFlags {
  const flags: UnifiedUpdateFlags = {}

  for (const token of argv) {
    if (!token.startsWith('--')) throw usageError(`Unexpected argument: ${token}`)

    const name = token.slice(2)
    if (!UPDATE_BOOLEAN_FLAGS.has(name)) throw usageError(`Unknown flag: --${name}`)
    if (name === 'dry-run') flags.dryRun = true
    if (name === 'cli-only') flags.cliOnly = true
    if (name === 'agents-only') flags.agentsOnly = true
  }

  if (flags.cliOnly && flags.agentsOnly) {
    throw usageError('--cli-only and --agents-only cannot be used together')
  }

  return flags
}

const DEV_SESSION_COMMANDS = new Set<DevSessionCommand>([
  'start',
  'list',
  'status',
  'close',
  'archive',
  'clean',
])
const DEV_SESSION_FLAGS: Record<DevSessionCommand, Set<string>> = {
  start: new Set(['title']),
  list: new Set(),
  status: new Set(['id']),
  close: new Set(['id']),
  archive: new Set(['id']),
  clean: new Set(['id', 'all', 'force', 'dry-run']),
}

export function parseDevSessionArgs(argv: string[]): ParsedDevSessionArgs {
  const [commandValue, ...rest] = argv
  if (!commandValue || !DEV_SESSION_COMMANDS.has(commandValue as DevSessionCommand)) {
    throw usageError(`Unknown dev session command: ${commandValue ?? 'missing'}`)
  }
  const command = commandValue as DevSessionCommand
  const flags: ParsedDevSessionArgs['flags'] = {}

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw usageError(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    if (!isKnownFlag(name)) throw usageError(`Unknown flag: --${name}`)
    if (!DEV_SESSION_FLAGS[command].has(name)) {
      throw usageError(`Flag --${name} is not valid for dev session ${command}`)
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === 'all') flags.all = true
      if (name === 'force') flags.force = true
      if (name === 'dry-run') flags.dryRun = true
      continue
    }
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw usageError(`Missing value for --${name}`)
    if (name === 'id') flags.id = value
    if (name === 'title') flags.title = value
    index += 1
  }

  if (command === 'clean' && flags.id && flags.all) {
    throw usageError('--id and --all cannot be used together')
  }
  return { command, flags }
}

const BRAIN_HOOK_COMMANDS = new Set([
  'install',
  'status',
  'uninstall',
  'run',
] as const)

export function parseBrainHookArgs(argv: string[]): ParsedBrainHookArgs {
  const [commandValue, ...rest] = argv
  if (!commandValue || !BRAIN_HOOK_COMMANDS.has(commandValue as never)) {
    throw usageError(`Unknown brain hook command: ${commandValue ?? 'missing'}`)
  }
  const command = commandValue as ParsedBrainHookArgs['command']
  const allowed = command === 'run'
    ? new Set(['agent', 'event', 'data', 'data-file'])
    : command === 'status'
      ? new Set(['agent', 'repo'])
      : new Set(['agent', 'repo', 'dry-run', 'force'])
  const flags: ParsedBrainHookArgs['flags'] = {}

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw usageError(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    if (!isKnownFlag(name)) throw usageError(`Unknown flag: --${name}`)
    if (!allowed.has(name)) {
      throw usageError(`Flag --${name} is not valid for brain hook ${command}`)
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === 'dry-run') flags.dryRun = true
      if (name === 'force') flags.force = true
      continue
    }
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw usageError(`Missing value for --${name}`)
    if (name === 'agent') flags.agent = value as ParsedBrainHookArgs['flags']['agent']
    if (name === 'repo') flags.repo = value
    if (name === 'event') flags.event = value
    if (name === 'data') flags.data = value
    if (name === 'data-file') {
      ;(flags as ParsedBrainHookArgs['flags'] & { dataFile?: string }).dataFile = value
    }
    index += 1
  }
  if (command === 'run' && (!flags.agent || flags.agent === 'all' || !flags.event)) {
    throw usageError('brain hook run requires one --agent and --event')
  }
  if (
    command === 'run' &&
    flags.data &&
    (flags as ParsedBrainHookArgs['flags'] & { dataFile?: string }).dataFile
  ) {
    throw usageError('brain hook run cannot combine --data and --data-file')
  }
  return { command, flags }
}

const BRAIN_SCHEDULE_COMMANDS = new Set(['install', 'status', 'uninstall'] as const)

export function parseBrainScheduleArgs(argv: string[]): ParsedBrainScheduleArgs {
  const [commandValue, ...rest] = argv
  if (!commandValue || !BRAIN_SCHEDULE_COMMANDS.has(commandValue as never)) {
    throw usageError(`Unknown brain schedule command: ${commandValue ?? 'missing'}`)
  }
  const command = commandValue as ParsedBrainScheduleArgs['command']
  const allowed = command === 'install'
    ? new Set(['interval', 'dry-run'])
    : command === 'uninstall'
      ? new Set(['dry-run'])
      : new Set<string>()
  const flags: ParsedBrainScheduleArgs['flags'] = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw usageError(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    if (!isKnownFlag(name)) throw usageError(`Unknown flag: --${name}`)
    if (!allowed.has(name)) {
      throw usageError(`Flag --${name} is not valid for brain schedule ${command}`)
    }
    if (name === 'dry-run') {
      flags.dryRun = true
      continue
    }
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw usageError(`Missing value for --${name}`)
    if (name === 'interval') flags.interval = value
    index += 1
  }
  return { command, flags }
}

function isKnownFlag(name: string): boolean {
  return BOOLEAN_FLAGS.has(name) || VALUE_FLAGS.has(name)
}

function isAllowedForCommand(
  topic: string | undefined,
  command: string | undefined,
  name: string,
): boolean {
  if (!topic || !command) return false
  return FLAGS_BY_TOPIC_COMMAND[topic]?.[command]?.has(name) ?? false
}

function parseValue(name: string, value: string): string | string[] {
  if (name === 'skills' || name === 'rules' || name === 'tools') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return value
}

function toCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}
