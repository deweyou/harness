import type { ParsedArgs, UsageError } from './types.ts'

const BOOLEAN_FLAGS = new Set([
  'all',
  'global',
  'yes',
  'dry-run',
  'force',
  'no-server',
])
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
    clean: new Set(['all', 'branch', 'dry-run']),
    demo: new Set(['branch', 'host', 'port', 'no-server', 'dry-run']),
    uninstall: new Set(['dry-run']),
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
