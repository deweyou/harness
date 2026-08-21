import { describe, expect, it, vi } from 'vitest';
import { CordisCapabilityRuntime, type CapabilityProvider } from '../src/core/capabilities.js';

function provider(id: string, capabilityId: string, content: string): CapabilityProvider {
  return {
    id,
    async list() {
      return [{ id: capabilityId, kind: 'skill', description: capabilityId }];
    },
    async load(requested, mode) {
      if (requested !== capabilityId) return undefined;
      return {
        id: capabilityId,
        kind: 'skill',
        description: capabilityId,
        locator: `memory:${capabilityId}`,
        digest: content,
        ...(mode === 'full' ? { content } : {}),
      };
    },
  };
}

describe('CordisCapabilityRuntime', () => {
  it('resolves scoped providers from specific to general and replays idempotent activation', async () => {
    const runtime = new CordisCapabilityRuntime();
    await runtime.register(provider('workspace', 'review', 'workspace'), { workspaceId: 'workspace-1' });
    await runtime.register(provider('global', 'review', 'global'));

    const request = {
      capabilityId: 'review',
      mode: 'full' as const,
      scope: { workspaceId: 'workspace-1', runId: 'run-1' },
      idempotencyKey: 'activate-review',
    };
    const first = await runtime.activate(request);
    const replay = await runtime.activate(request);

    expect(first.providerId).toBe('workspace');
    expect(first.content).toBe('workspace');
    expect(replay).toEqual(first);
    await runtime.dispose();
  });

  it('rejects idempotency conflicts and aborted activation', async () => {
    const runtime = new CordisCapabilityRuntime();
    await runtime.register(provider('global', 'review', 'global'));
    await runtime.activate({ capabilityId: 'review', mode: 'metadata', scope: {}, idempotencyKey: 'same' });
    await expect(runtime.activate({ capabilityId: 'review', mode: 'full', scope: {}, idempotencyKey: 'same' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const controller = new AbortController();
    controller.abort();
    await expect(runtime.activate({ capabilityId: 'review', mode: 'full', scope: {}, idempotencyKey: 'aborted', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'CAPABILITY_ACTIVATION_ABORTED' });
    await runtime.dispose();
  });

  it('disposes provider lifecycle through Cordis', async () => {
    const runtime = new CordisCapabilityRuntime();
    const dispose = vi.fn();
    const unregister = await runtime.register({ ...provider('global', 'review', 'global'), dispose });
    await unregister();
    expect(dispose).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it('rejects incomplete hierarchical scopes', async () => {
    const runtime = new CordisCapabilityRuntime();
    await expect(runtime.register(provider('invalid', 'review', 'value'), { runId: 'run-1' }))
      .rejects.toMatchObject({ code: 'INVALID_CAPABILITY_SCOPE' });
    await runtime.dispose();
  });
});
