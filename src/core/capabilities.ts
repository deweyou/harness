import { randomUUID } from 'node:crypto';
import { Context, type Fiber } from '@deepseek-ai/cordis';
import { invariant } from './errors.js';

export type CapabilityKind = 'skill' | 'rule' | 'knowledge' | 'executor' | 'host' | 'approval' | 'telemetry';
export type CapabilityLoadMode = 'metadata' | 'full';

export interface CapabilityScope {
  workspaceId?: string;
  runId?: string;
  plannedNodeId?: string;
  executionId?: string;
}

export interface CapabilitySummary {
  id: string;
  kind: CapabilityKind;
  description: string;
}

export interface LoadedCapability extends CapabilitySummary {
  locator: string;
  digest: string;
  content?: string;
}

export interface CapabilityProvider {
  id: string;
  list(scope: CapabilityScope, signal: AbortSignal): Promise<CapabilitySummary[]>;
  load(id: string, mode: CapabilityLoadMode, scope: CapabilityScope, signal: AbortSignal): Promise<LoadedCapability | undefined>;
  dispose?(): Promise<void> | void;
}

export interface CapabilityActivationRequest {
  capabilityId: string;
  mode: CapabilityLoadMode;
  scope: CapabilityScope;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface CapabilityActivationReceipt extends LoadedCapability {
  activationId: string;
  providerId: string;
  scopeKey: string;
}

export interface CapabilityRuntime {
  register(provider: CapabilityProvider, scope?: CapabilityScope): Promise<() => Promise<void>>;
  list(scope: CapabilityScope, kind?: CapabilityKind, signal?: AbortSignal): Promise<CapabilitySummary[]>;
  activate(request: CapabilityActivationRequest): Promise<CapabilityActivationReceipt>;
  dispose(): Promise<void>;
}

export interface StructuredExecutionRequest {
  executionId: string;
  idempotencyKey: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
}

export interface StructuredExecutionResult {
  status: 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  output: Record<string, unknown>;
  evidence: Array<{ digest: string; locator: string; summary: string }>;
}

/** Host adapters implement this boundary; Cordis only owns its lifecycle. */
export interface StructuredExecutor {
  kind: string;
  execute(request: StructuredExecutionRequest): Promise<StructuredExecutionResult>;
}

interface ProviderRegistration {
  provider: CapabilityProvider;
  scope: CapabilityScope;
  fiber: Fiber;
}

interface ActivationRecord {
  fingerprint: string;
  receipt: CapabilityActivationReceipt;
  fiber: Fiber;
}

function scopeKey(scope: CapabilityScope): string {
  return [scope.workspaceId, scope.runId, scope.plannedNodeId, scope.executionId].map((value) => value ?? '*').join('/');
}

function appliesTo(registered: CapabilityScope, requested: CapabilityScope): boolean {
  return (['workspaceId', 'runId', 'plannedNodeId', 'executionId'] as const)
    .every((key) => registered[key] === undefined || registered[key] === requested[key]);
}

function scopeSpecificity(scope: CapabilityScope): number {
  return [scope.workspaceId, scope.runId, scope.plannedNodeId, scope.executionId].filter(Boolean).length;
}

function assertScope(scope: CapabilityScope): void {
  invariant(!scope.runId || Boolean(scope.workspaceId), 'INVALID_CAPABILITY_SCOPE', 'Run scope requires workspaceId');
  invariant(!scope.plannedNodeId || Boolean(scope.workspaceId && scope.runId), 'INVALID_CAPABILITY_SCOPE', 'Planned-node scope requires workspaceId and runId');
  invariant(
    !scope.executionId || Boolean(scope.workspaceId && scope.runId && scope.plannedNodeId),
    'INVALID_CAPABILITY_SCOPE',
    'Execution scope requires workspaceId, runId, and plannedNodeId',
  );
}

function activationFingerprint(request: CapabilityActivationRequest): string {
  return JSON.stringify({ capabilityId: request.capabilityId, mode: request.mode, scope: request.scope });
}

/**
 * Cordis owns provider and activation lifecycles. Harness Core remains the
 * authority for Runs, Plans, Claims, Evidence, and execution transitions.
 */
export class CordisCapabilityRuntime implements CapabilityRuntime {
  private readonly root = new Context();
  private readonly providers = new Map<string, ProviderRegistration>();
  private readonly activations = new Map<string, ActivationRecord>();

  async register(provider: CapabilityProvider, scope: CapabilityScope = {}): Promise<() => Promise<void>> {
    assertScope(scope);
    invariant(!this.providers.has(provider.id), 'CAPABILITY_PROVIDER_EXISTS', `Provider '${provider.id}' is already registered`);
    const context = this.root.isolate('harnessCapability', Symbol(`${provider.id}:${scopeKey(scope)}`));
    const fiber = await context.plugin(() => async () => provider.dispose?.());
    this.providers.set(provider.id, { provider, scope, fiber });
    return async () => {
      const current = this.providers.get(provider.id);
      if (!current) return;
      this.providers.delete(provider.id);
      await current.fiber.dispose();
    };
  }

  async list(scope: CapabilityScope, kind?: CapabilityKind, signal: AbortSignal = new AbortController().signal): Promise<CapabilitySummary[]> {
    assertScope(scope);
    const summaries = await Promise.all(
      [...this.providers.values()]
        .filter((registration) => appliesTo(registration.scope, scope))
        .sort((left, right) => scopeSpecificity(left.scope) - scopeSpecificity(right.scope))
        .map(({ provider }) => provider.list(scope, signal)),
    );
    const unique = new Map<string, CapabilitySummary>();
    for (const summary of summaries.flat()) {
      if (!kind || summary.kind === kind) unique.set(`${summary.kind}:${summary.id}`, summary);
    }
    return [...unique.values()];
  }

  async activate(request: CapabilityActivationRequest): Promise<CapabilityActivationReceipt> {
    assertScope(request.scope);
    const fingerprint = activationFingerprint(request);
    const existing = this.activations.get(request.idempotencyKey);
    if (existing) {
      invariant(existing.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', `Idempotency key '${request.idempotencyKey}' has different activation input`);
      return existing.receipt;
    }
    const signal = request.signal ?? new AbortController().signal;
    invariant(!signal.aborted, 'CAPABILITY_ACTIVATION_ABORTED', `Activation of '${request.capabilityId}' was aborted`);
    const registrations = [...this.providers.values()]
      .filter((registration) => appliesTo(registration.scope, request.scope))
      .map((registration, index) => ({ registration, index }))
      .sort((left, right) => scopeSpecificity(right.registration.scope) - scopeSpecificity(left.registration.scope) || right.index - left.index);
    for (const { registration } of registrations) {
      const loaded = await registration.provider.load(request.capabilityId, request.mode, request.scope, signal);
      if (!loaded) continue;
      invariant(!signal.aborted, 'CAPABILITY_ACTIVATION_ABORTED', `Activation of '${request.capabilityId}' was aborted`);
      const context = this.root.isolate('harnessCapability', Symbol(`${request.idempotencyKey}:${scopeKey(request.scope)}`));
      const fiber = await context.plugin(() => () => undefined);
      const receipt: CapabilityActivationReceipt = {
        ...loaded,
        activationId: randomUUID(),
        providerId: registration.provider.id,
        scopeKey: scopeKey(request.scope),
      };
      this.activations.set(request.idempotencyKey, { fingerprint, receipt, fiber });
      return receipt;
    }
    throw new Error(`Capability '${request.capabilityId}' is unavailable in scope '${scopeKey(request.scope)}'`);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.activations.values()].map(({ fiber }) => fiber.dispose()));
    this.activations.clear();
    await Promise.all([...this.providers.values()].map(({ fiber }) => fiber.dispose()));
    this.providers.clear();
    await this.root.fiber.dispose();
  }
}
