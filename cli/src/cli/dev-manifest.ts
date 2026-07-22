import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { CLI_CAPABILITIES, CLI_VERSION } from './version-contract.ts'

export interface DdevManifest {
  schema_version: number
  runtime_schema: number
  event_schema: number
  minimum_cli_version: string
  required_cli_capabilities: string[]
  module_skills: string[]
  required_rules: string[]
  session_files: string[]
}

export function ddevManifestPath(homeDir: string): string {
  return join(homeDir, '.deweyou', 'agents', 'assets', 'skills', 'ddev', 'runtime.json')
}

export async function loadDdevManifest(homeDir: string): Promise<DdevManifest> {
  const path = ddevManifestPath(homeDir)
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(
      `DDev runtime manifest is unavailable: ${path}. Run \`deweyou-cli agent update\`.`,
      { cause: error },
    )
  }

  if (!isManifest(value)) {
    throw new Error(`DDev runtime manifest is invalid: ${path}. Run \`deweyou-cli agent update\`.`)
  }

  return value
}

export function assertDdevCompatibility(manifest: DdevManifest): void {
  if (compareVersions(CLI_VERSION, manifest.minimum_cli_version) < 0) {
    throw new Error(
      `DDev requires deweyou-cli >= ${manifest.minimum_cli_version}, current ${CLI_VERSION}. Run \`deweyou-cli update --cli-only\`.`,
    )
  }

  const available = new Set<string>(CLI_CAPABILITIES)
  const missing = manifest.required_cli_capabilities.filter((item) => !available.has(item))
  if (missing.length > 0) {
    throw new Error(
      `DDev requires unsupported CLI capabilities: ${missing.join(', ')}. Run \`deweyou-cli update --cli-only\`.`,
    )
  }
}

export async function assertDdevRuntimeAssets(
  homeDir: string,
  manifest: DdevManifest,
): Promise<void> {
  for (const skill of manifest.module_skills) {
    const path = join(homeDir, '.deweyou', 'agents', 'assets', 'skills', skill, 'SKILL.md')
    if (!await pathExists(path)) {
      throw new Error(`DDev module skill is missing: ${path}. Run \`deweyou-cli agent update\`.`)
    }
  }
  for (const rule of manifest.required_rules) {
    const path = join(homeDir, '.deweyou', 'agents', 'assets', 'rules', `${rule}.md`)
    if (!await pathExists(path)) {
      throw new Error(`DDev required rule is missing: ${path}. Run \`deweyou-cli agent update\`.`)
    }
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function isManifest(value: unknown): value is DdevManifest {
  if (!isRecord(value)) return false
  return Number.isInteger(value.schema_version)
    && Number.isInteger(value.runtime_schema)
    && Number.isInteger(value.event_schema)
    && typeof value.minimum_cli_version === 'string'
    && isStringArray(value.required_cli_capabilities)
    && isStringArray(value.module_skills)
    && isStringArray(value.required_rules)
    && isStringArray(value.session_files)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    /* v8 ignore next -- unexpected stat errors should surface unchanged */
    throw error
  }
}
