#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import packageManifest from '../../package.json' with { type: 'json' };
import { CordisCapabilityRuntime } from '../core/capabilities.js';
import { availableNodes, loadHarnessConfig } from '../core/config/load.js';
import { invariant } from '../core/errors.js';
import { ConfigResourceProvider } from '../core/resources.js';
import { findConfig, RunStore, type CommandContext } from '../core/state/store.js';
import type { PlannedNode } from '../core/types.js';

const VERSION = packageManifest.version;
const commandContextSchema = z.object({
  traceId: z.string().default(() => randomUUID()),
  spanId: z.string().default(() => randomUUID()),
  parentSpanId: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

async function configFor(workspacePath: string, configPath?: string) {
  const path = configPath ? resolve(workspacePath, configPath) : await findConfig(workspacePath);
  return { path, config: await loadHarnessConfig(path) };
}

async function workspaceId(workspacePath: string): Promise<string> {
  return RunStore.workspaceId(workspacePath);
}

function commandContext(input: z.infer<typeof commandContextSchema>): CommandContext {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    idempotencyKey: input.idempotencyKey,
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
  };
}

function capabilityScope(
  workspace: string,
  values: { runId?: string | undefined; plannedNodeId?: string | undefined; executionId?: string | undefined },
) {
  return {
    workspaceId: workspace,
    ...(values.runId ? { runId: values.runId } : {}),
    ...(values.plannedNodeId ? { plannedNodeId: values.plannedNodeId } : {}),
    ...(values.executionId ? { executionId: values.executionId } : {}),
  };
}

export function createHarnessServer(): McpServer {
  const server = new McpServer({ name: 'deweyou-harness', version: VERSION });
  const capabilities = new CordisCapabilityRuntime();
  const registeredProviders = new Map<string, { digest: string; dispose: () => Promise<void> }>();

  async function ensureCapabilities(workspacePath: string, configPath?: string) {
    const loaded = await configFor(workspacePath, configPath);
    const id = `${await workspaceId(workspacePath)}:${loaded.path}`;
    const digest = createHash('sha256').update(JSON.stringify(loaded.config)).digest('hex');
    const registered = registeredProviders.get(id);
    if (registered?.digest !== digest) {
      await registered?.dispose();
      const dispose = await capabilities.register(
        new ConfigResourceProvider(loaded.config, workspacePath, `${id}:${digest}`),
        { workspaceId: await workspaceId(workspacePath) },
      );
      registeredProviders.set(id, { digest, dispose });
    }
    return loaded;
  }

  server.registerTool(
    'config_inspect',
    {
      description: 'Load Harness v2 config and list reusable resources and Node Definitions. Workflow and Stage fields are rejected.',
      inputSchema: z.object({ workspacePath: z.string(), configPath: z.string().optional() }),
    },
    async ({ workspacePath, configPath }) => {
      const loaded = await configFor(workspacePath, configPath);
      return result({
        configPath: loaded.path,
        version: loaded.config.version,
        nodes: availableNodes(loaded.config),
        resources: Object.entries(loaded.config.resources).map(([id, resource]) => ({ id, kind: resource.kind, description: resource.description ?? id })),
        sourceFiles: loaded.config.sourceFiles,
      });
    },
  );

  server.registerTool(
    'run_create',
    {
      description: 'Create a durable Run and its first Commitment revision. Core allocates all identities and opens the acceptance Claims.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        request: z.record(z.string(), z.unknown()).default({}),
        hostSessionId: z.string().optional(),
        commitment: z.object({
          objective: z.string().min(1),
          scope: z.array(z.string()),
          authority: z.array(z.string()),
          destination: z.string().min(1),
          acceptance: z.array(z.object({ description: z.string().min(1) })).min(1),
          unresolvedDecisions: z.array(z.string()).default([]),
        }),
      }),
    },
    async ({ workspacePath, configPath, request, hostSessionId, commitment }) => {
      const { config } = await configFor(workspacePath, configPath);
      const run = await new RunStore().createRun({ workspacePath, request, config, commitment, ...(hostSessionId ? { hostSessionId } : {}) });
      return result({ run, projection: await new RunStore().getProjection(run.workspace.id, run.id) });
    },
  );

  server.registerTool(
    'run_get',
    {
      description: 'Verify the authoritative event chain and rebuild the current Run projection.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string(), recoverInterrupted: z.boolean().default(false) }),
    },
    async ({ workspacePath, runId, recoverInterrupted }) => {
      const id = await workspaceId(workspacePath);
      const store = new RunStore();
      return result(recoverInterrupted ? await store.recoverInterrupted(id, runId, randomUUID()) : await store.rebuildProjection(id, runId));
    },
  );

  server.registerTool(
    'commitment_revise',
    {
      description: 'Create the next immutable Commitment revision and supersede open acceptance Claims from the previous revision.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        commitment: z.object({
          objective: z.string().min(1),
          scope: z.array(z.string()),
          authority: z.array(z.string()),
          destination: z.string().min(1),
          acceptance: z.array(z.object({ description: z.string().min(1) })).min(1),
          unresolvedDecisions: z.array(z.string()).default([]),
        }),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, commitment, command }) => result(
      await new RunStore().reviseCommitment(await workspaceId(workspacePath), runId, commitment, commandContext(command)),
    ),
  );

  const plannedNodeSchema = z.object({
    id: z.string().min(1),
    definitionId: z.string().min(1),
    dependsOn: z.array(z.string()).default([]),
    input: z.record(z.string(), z.unknown()).optional(),
    targetClaimIds: z.array(z.string()).optional(),
    expectedOutputs: z.array(z.string()).optional(),
    authority: z.array(z.string()).optional(),
  });

  server.registerTool(
    'plan_propose',
    {
      description: 'Propose the next immutable task-scoped Plan DAG against the active Commitment revision.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        runId: z.string(),
        commitmentRevision: z.number().int().positive(),
        nodes: z.array(plannedNodeSchema),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, configPath, runId, commitmentRevision, nodes, command }) => {
      const { config } = await configFor(workspacePath, configPath);
      const projection = await new RunStore().getProjection(await workspaceId(workspacePath), runId);
      const commitment = projection.commitments[commitmentRevision];
      invariant(commitment, 'UNKNOWN_COMMITMENT', `Unknown Commitment revision ${commitmentRevision}`);
      const normalizedNodes = nodes.map((node): PlannedNode => {
        const definition = config.nodes[node.definitionId];
        invariant(definition, 'MISSING_NODE', `Unknown Node Definition '${node.definitionId}'`);
        for (const claimId of node.targetClaimIds ?? []) {
          invariant(commitment.acceptanceClaimIds.includes(claimId), 'UNREQUIRED_CLAIM', `Planned node '${node.id}' targets non-acceptance Claim '${claimId}'`);
        }
        const authority = node.authority ?? definition.authority ?? [];
        for (const item of authority) {
          invariant(commitment.authority.includes(item), 'UNAUTHORIZED_PLAN_NODE', `Planned node '${node.id}' requests unauthorized capability '${item}'`);
        }
        return {
          id: node.id,
          definitionId: node.definitionId,
          dependsOn: node.dependsOn,
          authority,
          expectedOutputs: node.expectedOutputs ?? definition.outputs ?? [],
          ...(node.input ? { input: node.input } : {}),
          ...(node.targetClaimIds ? { targetClaimIds: node.targetClaimIds } : {}),
        };
      });
      return result(await new RunStore().proposePlan(
        await workspaceId(workspacePath),
        runId,
        commitmentRevision,
        normalizedNodes,
        commandContext(command),
      ));
    },
  );

  server.registerTool(
    'plan_activate',
    {
      description: 'Activate a proposed Plan revision that targets the active Commitment.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string(), planRevision: z.number().int().positive(), command: commandContextSchema }),
    },
    async ({ workspacePath, runId, planRevision, command }) => result(
      await new RunStore().activatePlan(await workspaceId(workspacePath), runId, planRevision, commandContext(command)),
    ),
  );

  server.registerTool(
    'ready_nodes',
    {
      description: 'Return currently ready Planned Nodes from the active Plan revision.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string() }),
    },
    async ({ workspacePath, runId }) => result(await new RunStore().readyNodes(await workspaceId(workspacePath), runId)),
  );

  server.registerTool(
    'execution_start',
    {
      description: 'Start one ready Planned Node. Core allocates execution identity and contiguous attempt.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string(), plannedNodeId: z.string(), command: commandContextSchema }),
    },
    async ({ workspacePath, runId, plannedNodeId, command }) => result(
      await new RunStore().startExecution(await workspaceId(workspacePath), runId, plannedNodeId, commandContext(command)),
    ),
  );

  server.registerTool(
    'execution_finish',
    {
      description: 'Finish one running Node Execution exactly once with structured status and Evidence identities.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        executionId: z.string(),
        status: z.enum(['blocked', 'succeeded', 'failed', 'cancelled', 'skipped', 'interrupted']),
        evidenceIds: z.array(z.string()).default([]),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, executionId, status, evidenceIds, command }) => result(
      await new RunStore().finishExecution(await workspaceId(workspacePath), runId, executionId, status, evidenceIds, commandContext(command)),
    ),
  );

  server.registerTool(
    'evidence_record',
    {
      description: 'Store digest-addressed Evidence bound to the current Commitment revision and input digests.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        content: z.string(),
        kind: z.string(),
        summary: z.string(),
        commitmentRevision: z.number().int().positive(),
        inputDigests: z.record(z.string(), z.string()).default({}),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, command, ...input }) => result(
      await new RunStore().recordEvidence(await workspaceId(workspacePath), runId, input, commandContext(command)),
    ),
  );

  server.registerTool(
    'claim_update',
    {
      description: 'Satisfy, invalidate, or waive an open Claim using current Evidence.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        claimId: z.string(),
        status: z.enum(['satisfied', 'invalidated', 'waived']),
        evidenceIds: z.array(z.string()).default([]),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, claimId, status, evidenceIds, command }) => result(
      await new RunStore().updateClaim(await workspaceId(workspacePath), runId, claimId, status, evidenceIds, commandContext(command)),
    ),
  );

  server.registerTool(
    'run_complete',
    {
      description: 'Complete a Run only when the current Commitment and Plan revisions are active and every acceptance Claim has current Evidence.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        commitmentRevision: z.number().int().positive(),
        planRevision: z.number().int().positive(),
        destination: z.string().min(1),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, commitmentRevision, planRevision, destination, command }) => result(
      await new RunStore().completeRun(await workspaceId(workspacePath), runId, commitmentRevision, planRevision, destination, commandContext(command)),
    ),
  );

  server.registerTool(
    'capabilities_list',
    {
      description: 'List capability summaries available in the requested scope without loading full instructions.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        runId: z.string().optional(),
        plannedNodeId: z.string().optional(),
        executionId: z.string().optional(),
        kind: z.enum(['skill', 'rule', 'knowledge', 'executor', 'host', 'approval', 'telemetry']).optional(),
      }),
    },
    async ({ workspacePath, configPath, kind, ...scope }) => {
      await ensureCapabilities(workspacePath, configPath);
      return result(await capabilities.list(capabilityScope(await workspaceId(workspacePath), scope), kind));
    },
  );

  server.registerTool(
    'capability_activate',
    {
      description: 'Activate one capability through the scoped Cordis runtime and return a digest-bearing receipt.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        runId: z.string().optional(),
        plannedNodeId: z.string().optional(),
        executionId: z.string().optional(),
        capabilityId: z.string(),
        mode: z.enum(['metadata', 'full']),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, configPath, capabilityId, mode, command, ...scope }) => {
      await ensureCapabilities(workspacePath, configPath);
      const id = await workspaceId(workspacePath);
      const receipt = await capabilities.activate({ capabilityId, mode, scope: capabilityScope(id, scope), idempotencyKey: command.idempotencyKey });
      if (scope.runId) await new RunStore().recordResourceActivation(id, scope.runId, capabilityId, receipt.digest, commandContext(command));
      return result(receipt);
    },
  );

  server.registerTool(
    'resource_feedback_record',
    {
      description: 'Record Evidence-backed feedback attributed to one activated resource for post-completion retrospectives.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        resourceId: z.string(),
        category: z.string(),
        summary: z.string(),
        evidenceIds: z.array(z.string()).min(1),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, resourceId, category, summary, evidenceIds, command }) => {
      await new RunStore().recordResourceFeedback(
        await workspaceId(workspacePath),
        runId,
        resourceId,
        category,
        summary,
        evidenceIds,
        commandContext(command),
      );
      return result({ recorded: true, resourceId });
    },
  );

  server.registerTool(
    'retrospective_get',
    {
      description: 'Read the post-completion retrospective and evidence-attributed resource proposals.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string() }),
    },
    async ({ workspacePath, runId }) => result(await new RunStore().getRetrospective(await workspaceId(workspacePath), runId)),
  );

  server.registerTool(
    'proposal_decide',
    {
      description: 'Record acceptance or rejection of a resource proposal. Acceptance authorizes separate maintenance work only.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        proposalId: z.string(),
        decision: z.enum(['accepted', 'rejected']),
        reason: z.string().optional(),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, proposalId, decision, reason, command }) => result(
      await new RunStore().decideProposal(await workspaceId(workspacePath), runId, proposalId, decision, commandContext(command), reason),
    ),
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serveStdio(() => createHarnessServer());
}
