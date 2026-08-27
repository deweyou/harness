import { isAbsolute, win32 } from 'node:path';
import { HarnessError, invariant } from '../errors.js';
import { assertPortSchema } from '../port-schema.js';
import type { HarnessConfig, ResourceDefinition } from '../types.js';

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertId(id: string, label: string): void {
  invariant(ID_PATTERN.test(id), 'INVALID_ID', `${label} '${id}' must be a stable lowercase identifier`);
}

function assertString(value: unknown, label: string): asserts value is string {
  invariant(typeof value === 'string' && value.trim().length > 0, 'INVALID_CONFIG', `${label} must be a non-empty string`);
}

function assertRelativeImportPath(value: unknown): asserts value is string {
  assertString(value, 'Import path');
  invariant(
    !isAbsolute(value) && !win32.isAbsolute(value) && !/^[a-zA-Z]:/.test(value),
    'INVALID_IMPORT',
    `Import path '${value}' must be relative to its declaring config`,
  );
}

function assertStringArray(value: unknown, label: string): void {
  invariant(Array.isArray(value), 'INVALID_CONFIG', `${label} must be an array`);
  for (const item of value) assertString(item, `${label}[]`);
  invariant(new Set(value).size === value.length, 'INVALID_CONFIG', `${label} must not contain duplicates`);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(unknown.length === 0, 'UNKNOWN_CONFIG_FIELD', `${label} has unknown field(s): ${unknown.join(', ')}`);
}

function assertPorts(value: unknown, label: string): void {
  invariant(isRecord(value), 'INVALID_NODE', `${label} must be an object`);
  for (const [id, schema] of Object.entries(value)) {
    assertId(id, `${label} port`);
    invariant(isRecord(schema), 'INVALID_PORT_SCHEMA', `${label}.${id} must be a JSON Schema object`);
    assertPortSchema(schema as { description: string }, `${label}.${id}`);
  }
}

function validateResource(id: string, value: unknown, collection: 'Context' | 'Skill'): asserts value is ResourceDefinition {
  invariant(isRecord(value), 'INVALID_RESOURCE', `${collection} '${id}' must be an object`);
  assertKnownKeys(value, ['source'], `${collection} '${id}'`);
  invariant(isRecord(value.source), 'INVALID_RESOURCE', `${collection} '${id}' must define source`);
  const source = value.source;
  assertKnownKeys(source, ['repo', 'entry'], `${collection} '${id}' source`);
  assertString(source.entry, `${collection} '${id}' source.entry`);
  invariant(
    !isAbsolute(source.entry) && !win32.isAbsolute(source.entry) && !/^[a-zA-Z]:/.test(source.entry),
    'INVALID_RESOURCE',
    `${collection} '${id}' source.entry must be relative`,
  );
  if (source.repo !== undefined) assertString(source.repo, `${collection} '${id}' source.repo`);
}

export function validateConfigDocument(value: unknown, source: string): asserts value is HarnessConfig {
  invariant(isRecord(value), 'INVALID_CONFIG', `${source} must contain a YAML object`);
  assertKnownKeys(value, ['$schema', 'version', 'strategy', 'imports', 'context', 'skills', 'nodes'], source);
  invariant(value.version === 3, 'UNSUPPORTED_CONFIG_VERSION', `${source} must set version: 3`);
  if (value.strategy !== undefined) {
    invariant(['branch', 'worktree'].includes(String(value.strategy)), 'INVALID_STRATEGY', `${source} strategy must be branch or worktree`);
  }

  if (value.imports !== undefined) {
    invariant(Array.isArray(value.imports), 'INVALID_IMPORT', `${source} imports must be an array`);
    for (const entry of value.imports) {
      if (typeof entry === 'string') assertRelativeImportPath(entry);
      else {
        invariant(isRecord(entry), 'INVALID_IMPORT', 'Import must be a path string or object');
        assertKnownKeys(entry, ['path', 'as'], 'Import');
        assertRelativeImportPath(entry.path);
        if (entry.as !== undefined) {
          assertString(entry.as, 'Import namespace');
          assertId(entry.as, 'Import namespace');
        }
      }
    }
  }

  for (const [field, label] of [['context', 'Context'], ['skills', 'Skill']] as const) {
    const collection = value[field];
    if (collection !== undefined) {
      invariant(isRecord(collection), 'INVALID_CONFIG', `${field} must be an object`);
      for (const [id, resource] of Object.entries(collection)) {
        assertId(id, `${label} id`);
        validateResource(id, resource, label);
      }
    }
  }

  if (value.nodes !== undefined) {
    invariant(isRecord(value.nodes), 'INVALID_CONFIG', 'nodes must be an object');
    for (const [id, node] of Object.entries(value.nodes)) {
      assertId(id, 'Node id');
      invariant(isRecord(node), 'INVALID_NODE', `Node '${id}' must be an object`);
      const commonKeys = ['kind', 'description', 'inputs', 'outputs', 'authority'];
      invariant(['agent', 'command'].includes(String(node.kind)), 'INVALID_NODE_KIND', `Node '${id}' kind must be agent or command`);
      assertKnownKeys(node, node.kind === 'agent' ? [...commonKeys, 'skill'] : [...commonKeys, 'command'], `Node '${id}'`);
      assertString(node.description, `Node '${id}'.description`);
      if (node.authority !== undefined) assertStringArray(node.authority, `Node '${id}'.authority`);
      if (node.inputs !== undefined) assertPorts(node.inputs, `Node '${id}'.inputs`);
      if (node.outputs !== undefined) assertPorts(node.outputs, `Node '${id}'.outputs`);
      if (node.kind === 'agent' && node.skill !== undefined) assertStringArray(node.skill, `Node '${id}'.skill`);
      if (node.kind === 'command') assertString(node.command, `Node '${id}'.command`);
    }
  }
}

export function asHarnessError(error: unknown): HarnessError {
  return error instanceof HarnessError ? error : new HarnessError('CONFIG_LOAD_FAILED', error instanceof Error ? error.message : String(error));
}
