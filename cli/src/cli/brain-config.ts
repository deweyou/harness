import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import yaml from 'js-yaml'

import {
  type BrainConfig,
  type BrainPaths,
  type Classification,
} from './brain-types.ts'
import { isRecord, parseClassification, parseScopes } from './brain-schema.ts'

const { load: loadYaml, JSON_SCHEMA } = yaml

export function brainPaths(homeDir = homedir()): BrainPaths {
  const runtimeRoot = join(homeDir, '.deweyou', 'brain')
  return {
    homeDir,
    runtimeRoot,
    configPath: join(runtimeRoot, 'config.yaml'),
    databasePath: join(runtimeRoot, 'brain.sqlite'),
    queueRoot: join(runtimeRoot, 'queue'),
    quarantineRoot: join(runtimeRoot, 'quarantine'),
    rawSourcesRoot: join(runtimeRoot, 'raw-sources'),
    contextPackRoot: join(runtimeRoot, 'context-packs'),
    locksRoot: join(runtimeRoot, 'locks'),
    scheduleManifestPath: join(runtimeRoot, 'schedule.json'),
  }
}

export async function loadBrainConfig({
  homeDir = homedir(),
}: {
  homeDir?: string
} = {}): Promise<BrainConfig> {
  const paths = brainPaths(homeDir)
  let parsed: unknown
  try {
    parsed = loadYaml(await readFile(paths.configPath, 'utf8'), {
      schema: JSON_SCHEMA,
    })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      throw new Error(
        `Brain is not initialized: ${paths.configPath}. Run \`deweyou-cli brain init --repo <path>\`.`,
      )
    }
    throw error
  }
  return validateBrainConfig(parsed, paths.configPath)
}

export function validateBrainConfig(value: unknown, label = 'Brain config'): BrainConfig {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (value.schema_version !== 1) {
    throw new Error(`${label} schema_version must be 1`)
  }
  const sync = requiredRecord(value.sync, `${label}.sync`)
  const defaults = requiredRecord(value.defaults, `${label}.defaults`)
  const compiler = requiredRecord(value.compiler, `${label}.compiler`)
  const encryption = enumValue(
    sync.encryption,
    ['none', 'sensitive-only', 'all'] as const,
    `${label}.sync.encryption`,
  )
  if (encryption !== 'none') {
    throw new Error(
      `${label}.sync.encryption ${encryption} is reserved but not implemented in V1`,
    )
  }

  return {
    schema_version: 1,
    knowledge_repo: resolve(requiredString(value.knowledge_repo, `${label}.knowledge_repo`)),
    device_id: slug(requiredString(value.device_id, `${label}.device_id`), `${label}.device_id`),
    sync: {
      enabled: booleanValue(sync.enabled, true),
      remote: stringValue(sync.remote, 'origin'),
      branch: stringValue(sync.branch, 'main'),
      auto_push: booleanValue(sync.auto_push, true),
      encryption,
      profile: enumValue(sync.profile, ['full', 'knowledge'] as const, `${label}.sync.profile`),
    },
    defaults: {
      classification: parseClassification(
        defaults.classification ?? 'private',
        `${label}.defaults`,
      ),
      scopes: parseScopes(defaults.scopes ?? ['personal'], `${label}.defaults`),
      clearance: parseClassification(
        defaults.clearance ?? 'private',
        `${label}.defaults.clearance`,
      ),
      token_budget: positiveInteger(
        defaults.token_budget ?? 2000,
        `${label}.defaults.token_budget`,
      ),
    },
    compiler: {
      provider: enumValue(
        compiler.provider,
        ['none', 'command'] as const,
        `${label}.compiler.provider`,
      ),
      command: stringArray(compiler.command ?? [], `${label}.compiler.command`),
      policy_version: stringValue(compiler.policy_version, 'v1'),
    },
  }
}

export function createBrainConfig({
  repoPath,
  deviceId,
  remote = 'origin',
  branch = 'main',
}: {
  repoPath: string
  deviceId: string
  remote?: string
  branch?: string
}): BrainConfig {
  return {
    schema_version: 1,
    knowledge_repo: resolve(repoPath),
    device_id: slug(deviceId, 'device id'),
    sync: {
      enabled: true,
      remote,
      branch,
      auto_push: true,
      encryption: 'none',
      profile: 'full',
    },
    defaults: {
      classification: 'private',
      scopes: ['personal'],
      clearance: 'private',
      token_budget: 2000,
    },
    compiler: {
      provider: 'none',
      command: [],
      policy_version: 'v1',
    },
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('Brain config boolean value is invalid')
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(value)
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must be a string array`)
  }
  return value as string[]
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(', ')}`)
  }
  return value as T[number]
}

function slug(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a lowercase filesystem-safe id`)
  }
  return value
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
