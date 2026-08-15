import { isAbsolute } from 'node:path';
import { HarnessError, invariant } from '../errors.js';
import { STAGES, type HarnessConfig, type NodeInstance, type ResourceDefinition } from '../types.js';

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

function assertKnownKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(unknown.length === 0, 'UNKNOWN_CONFIG_FIELD', `${label} has unknown field(s): ${unknown.join(', ')}`);
}

function validateResource(id: string, value: unknown): asserts value is ResourceDefinition {
  invariant(isRecord(value), 'INVALID_RESOURCE', `Resource '${id}' must be an object`);
  assertKnownKeys(value, ['kind', 'description', 'source'], `Resource '${id}'`);
  invariant(['skill', 'rule', 'knowledge'].includes(String(value.kind)), 'INVALID_RESOURCE', `Resource '${id}' has an invalid kind`);
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

function validateNodeInstance(instance: unknown, label: string): asserts instance is NodeInstance {
  invariant(isRecord(instance), 'INVALID_NODE_INSTANCE', `${label} must be an object`);
  assertKnownKeys(instance, ['use', 'id', 'needs', 'with'], label);
  assertString(instance.use, `${label}.use`);
  if (instance.id !== undefined) {
    assertString(instance.id, `${label}.id`);
    assertId(instance.id, `${label}.id`);
  }
  if (instance.needs !== undefined) {
    invariant(Array.isArray(instance.needs), 'INVALID_NODE_INSTANCE', `${label}.needs must be an array`);
    for (const dependency of instance.needs) assertString(dependency, `${label}.needs[]`);
  }
  if (instance.with !== undefined) invariant(isRecord(instance.with), 'INVALID_NODE_INSTANCE', `${label}.with must be an object`);
}

export function validateConfigDocument(value: unknown, source: string): asserts value is HarnessConfig {
  invariant(isRecord(value), 'INVALID_CONFIG', `${source} must contain a YAML object`);
  assertKnownKeys(value, ['$schema', 'version', 'imports', 'resources', 'nodes', 'workflows'], source);
  invariant(value.version === 1, 'UNSUPPORTED_CONFIG_VERSION', `${source} must set version: 1`);

  if (value.imports !== undefined) {
    invariant(Array.isArray(value.imports), 'INVALID_IMPORT', `${source} imports must be an array`);
    for (const entry of value.imports) {
      if (typeof entry === 'string') {
        assertString(entry, 'Import path');
      } else {
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
      assertKnownKeys(node, ['name', 'description', 'executor'], `Node '${id}'`);
      if (node.name !== undefined) assertString(node.name, `Node '${id}'.name`);
      if (node.description !== undefined) assertString(node.description, `Node '${id}'.description`);
      const executor = node.executor;
      invariant(executor.type === 'agent' || executor.type === 'command', 'INVALID_EXECUTOR', `Node '${id}' has an invalid executor type`);
      if (executor.type === 'agent') {
        assertKnownKeys(executor, ['type', 'skills'], `Node '${id}' executor`);
        if (executor.skills !== undefined) {
          invariant(Array.isArray(executor.skills), 'INVALID_EXECUTOR', `Node '${id}' skills must be an array`);
          for (const skill of executor.skills) assertString(skill, `Node '${id}' skill`);
        }
      } else {
        assertKnownKeys(executor, ['type', 'command'], `Node '${id}' executor`);
        assertString(executor.command, `Node '${id}' command`);
      }
    }
  }

  if (value.workflows !== undefined) {
    invariant(isRecord(value.workflows), 'INVALID_CONFIG', 'workflows must be an object');
    for (const [id, workflow] of Object.entries(value.workflows)) {
      assertId(id, 'Workflow id');
      invariant(isRecord(workflow), 'INVALID_WORKFLOW', `Workflow '${id}' must be an object`);
      assertKnownKeys(workflow, ['name', 'description', 'selectable', 'extends', 'rules', 'knowledge', 'stages'], `Workflow '${id}'`);
      assertString(workflow.name, `Workflow '${id}'.name`);
      assertString(workflow.description, `Workflow '${id}'.description`);
      if (workflow.selectable !== undefined) invariant(typeof workflow.selectable === 'boolean', 'INVALID_WORKFLOW', `Workflow '${id}'.selectable must be boolean`);
      if (workflow.extends !== undefined) assertString(workflow.extends, `Workflow '${id}'.extends`);
      for (const field of ['rules', 'knowledge'] as const) {
        if (workflow[field] !== undefined) {
          invariant(Array.isArray(workflow[field]), 'INVALID_WORKFLOW', `Workflow '${id}'.${field} must be an array`);
          for (const resource of workflow[field]) assertString(resource, `Workflow '${id}'.${field}[]`);
        }
      }
      if (workflow.stages !== undefined) {
        invariant(isRecord(workflow.stages), 'INVALID_WORKFLOW', `Workflow '${id}'.stages must be an object`);
        for (const [stage, instances] of Object.entries(workflow.stages)) {
          invariant(STAGES.includes(stage as (typeof STAGES)[number]), 'INVALID_STAGE', `Workflow '${id}' uses unsupported stage '${stage}'`);
          invariant(Array.isArray(instances), 'INVALID_STAGE', `Workflow '${id}' stage '${stage}' must be an array`);
          instances.forEach((instance, index) => validateNodeInstance(instance, `Workflow '${id}' ${stage}[${index}]`));
        }
      }
    }
  }
}

export function asHarnessError(error: unknown): HarnessError {
  return error instanceof HarnessError ? error : new HarnessError('CONFIG_LOAD_FAILED', error instanceof Error ? error.message : String(error));
}
