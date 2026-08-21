import { isAbsolute } from 'node:path';
import { HarnessError, invariant } from '../errors.js';
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

function assertStringArray(value: unknown, label: string): void {
  invariant(Array.isArray(value), 'INVALID_CONFIG', `${label} must be an array`);
  for (const item of value) assertString(item, `${label}[]`);
  invariant(new Set(value).size === value.length, 'INVALID_CONFIG', `${label} must not contain duplicates`);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(unknown.length === 0, 'UNKNOWN_CONFIG_FIELD', `${label} has unknown field(s): ${unknown.join(', ')}`);
}

function validateResource(id: string, value: unknown): asserts value is ResourceDefinition {
  invariant(isRecord(value), 'INVALID_RESOURCE', `Resource '${id}' must be an object`);
  assertKnownKeys(value, ['kind', 'description', 'source'], `Resource '${id}'`);
  invariant(['skill', 'rule', 'knowledge'].includes(String(value.kind)), 'INVALID_RESOURCE', `Resource '${id}' has an invalid kind`);
  if (value.description !== undefined) assertString(value.description, `Resource '${id}'.description`);
  invariant(isRecord(value.source), 'INVALID_RESOURCE', `Resource '${id}' must define source`);
  const source = value.source;
  const sourceFields = source.type === 'workspace' ? ['type', 'path'] : source.type === 'registry' ? ['type', 'repo', 'skill'] : ['type', 'repo', 'path', 'ref'];
  assertKnownKeys(source, sourceFields, `Resource '${id}' source`);
  invariant(['workspace', 'registry', 'git'].includes(String(source.type)), 'INVALID_RESOURCE', `Resource '${id}' has an invalid source type`);
  if (source.type === 'workspace') {
    assertString(source.path, `Resource '${id}' source.path`);
    invariant(!isAbsolute(source.path), 'INVALID_RESOURCE', `Workspace resource '${id}' path must be relative to its config`);
  } else if (source.type === 'registry') {
    assertString(source.repo, `Resource '${id}' source.repo`);
    assertString(source.skill, `Resource '${id}' source.skill`);
  } else {
    assertString(source.repo, `Resource '${id}' source.repo`);
    assertString(source.path, `Resource '${id}' source.path`);
    if (source.ref !== undefined) assertString(source.ref, `Resource '${id}' source.ref`);
  }
}

export function validateConfigDocument(value: unknown, source: string): asserts value is HarnessConfig {
  invariant(isRecord(value), 'INVALID_CONFIG', `${source} must contain a YAML object`);
  assertKnownKeys(value, ['$schema', 'version', 'imports', 'resources', 'nodes'], source);
  invariant(value.version === 2, 'UNSUPPORTED_CONFIG_VERSION', `${source} must set version: 2`);

  if (value.imports !== undefined) {
    invariant(Array.isArray(value.imports), 'INVALID_IMPORT', `${source} imports must be an array`);
    for (const entry of value.imports) {
      if (typeof entry === 'string') assertString(entry, 'Import path');
      else {
        invariant(isRecord(entry), 'INVALID_IMPORT', 'Import must be a path string or object');
        assertKnownKeys(entry, ['path', 'as'], 'Import');
        assertString(entry.path, 'Import path');
        if (entry.as !== undefined) {
          assertString(entry.as, 'Import namespace');
          assertId(entry.as, 'Import namespace');
        }
      }
    }
  }

  if (value.resources !== undefined) {
    invariant(isRecord(value.resources), 'INVALID_CONFIG', 'resources must be an object');
    for (const [id, resource] of Object.entries(value.resources)) {
      assertId(id, 'Resource id');
      validateResource(id, resource);
    }
  }

  if (value.nodes !== undefined) {
    invariant(isRecord(value.nodes), 'INVALID_CONFIG', 'nodes must be an object');
    for (const [id, node] of Object.entries(value.nodes)) {
      assertId(id, 'Node id');
      invariant(isRecord(node) && isRecord(node.executor), 'INVALID_NODE', `Node '${id}' must define executor`);
      assertKnownKeys(node, ['name', 'description', 'executor', 'resources', 'inputs', 'outputs', 'claimTypes', 'artifactTypes', 'authority', 'executionPolicy'], `Node '${id}'`);
      if (node.name !== undefined) assertString(node.name, `Node '${id}'.name`);
      if (node.description !== undefined) assertString(node.description, `Node '${id}'.description`);
      for (const field of ['resources', 'inputs', 'outputs', 'claimTypes', 'artifactTypes', 'authority'] as const) {
        if (node[field] !== undefined) assertStringArray(node[field], `Node '${id}'.${field}`);
      }
      if (node.executionPolicy !== undefined) {
        invariant(isRecord(node.executionPolicy), 'INVALID_NODE', `Node '${id}'.executionPolicy must be an object`);
        assertKnownKeys(node.executionPolicy, ['idempotent', 'timeoutMs', 'retry'], `Node '${id}'.executionPolicy`);
        invariant(typeof node.executionPolicy.idempotent === 'boolean', 'INVALID_NODE', `Node '${id}'.executionPolicy.idempotent must be boolean`);
        if (node.executionPolicy.timeoutMs !== undefined) {
          invariant(Number.isInteger(node.executionPolicy.timeoutMs) && Number(node.executionPolicy.timeoutMs) > 0, 'INVALID_NODE', `Node '${id}'.executionPolicy.timeoutMs must be a positive integer`);
        }
        if (node.executionPolicy.retry !== undefined) {
          invariant(isRecord(node.executionPolicy.retry), 'INVALID_NODE', `Node '${id}'.executionPolicy.retry must be an object`);
          assertKnownKeys(node.executionPolicy.retry, ['maxAttempts', 'backoffMs'], `Node '${id}'.executionPolicy.retry`);
          invariant(Number.isInteger(node.executionPolicy.retry.maxAttempts) && Number(node.executionPolicy.retry.maxAttempts) > 0, 'INVALID_NODE', `Node '${id}'.executionPolicy.retry.maxAttempts must be a positive integer`);
          if (node.executionPolicy.retry.backoffMs !== undefined) {
            invariant(Number.isInteger(node.executionPolicy.retry.backoffMs) && Number(node.executionPolicy.retry.backoffMs) >= 0, 'INVALID_NODE', `Node '${id}'.executionPolicy.retry.backoffMs must be a non-negative integer`);
          }
        }
      }
      const executor = node.executor;
      invariant(['agent', 'command', 'capability'].includes(String(executor.kind)), 'INVALID_EXECUTOR', `Node '${id}' has an invalid executor kind`);
      if (executor.kind === 'agent') {
        assertKnownKeys(executor, ['kind', 'skills', 'config'], `Node '${id}' executor`);
        if (executor.skills !== undefined) assertStringArray(executor.skills, `Node '${id}' executor.skills`);
        if (executor.config !== undefined) invariant(isRecord(executor.config), 'INVALID_EXECUTOR', `Node '${id}' executor.config must be an object`);
      } else if (executor.kind === 'command') {
        assertKnownKeys(executor, ['kind', 'argv', 'cwd'], `Node '${id}' executor`);
        const argv = executor.argv;
        invariant(Array.isArray(argv), 'INVALID_EXECUTOR', `Node '${id}' executor.argv must be an array`);
        assertStringArray(argv, `Node '${id}' executor.argv`);
        invariant(argv.length > 0, 'INVALID_EXECUTOR', `Node '${id}' executor.argv must not be empty`);
        if (executor.cwd !== undefined) assertString(executor.cwd, `Node '${id}' executor.cwd`);
      } else {
        assertKnownKeys(executor, ['kind', 'capability', 'config'], `Node '${id}' executor`);
        assertString(executor.capability, `Node '${id}' executor.capability`);
        if (executor.config !== undefined) invariant(isRecord(executor.config), 'INVALID_EXECUTOR', `Node '${id}' executor.config must be an object`);
      }
    }
  }
}

export function asHarnessError(error: unknown): HarnessError {
  return error instanceof HarnessError ? error : new HarnessError('CONFIG_LOAD_FAILED', error instanceof Error ? error.message : String(error));
}
