#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import packageManifest from '../../package.json' with { type: 'json' };
import { CordisCapabilityRuntime } from '../core/capabilities.js';
import { availableNodes, loadHarnessConfig } from '../core/config/load.js';
import { invariant } from '../core/errors.js';
import { assertPortValues } from '../core/port-schema.js';
import { ConfigResourceProvider } from '../core/resources.js';
import { findConfig, RUN_CONFIG_SNAPSHOT_PATH, RunStore, type CommandContext } from '../core/state/store.js';
import { PLAN_PHASES, type PlannedNode } from '../core/types.js';
import { WorkspacePreparer } from '../core/workspace.js';
import { maintainDashboardServer } from '../dashboard/server.js';

export { maintainDashboardServer };

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

  async function ensureCapabilities(workspacePath: string, configPath?: string, runId?: string) {
    invariant(!(runId && configPath), 'RUN_CONFIG_PATH_FORBIDDEN', 'Run-scoped capabilities use the Run configuration snapshot and do not accept configPath');
    const workspace = await workspaceId(workspacePath);
    const store = new RunStore();
    const loaded = runId
      ? { path: RUN_CONFIG_SNAPSHOT_PATH, config: await store.readConfigSnapshot(workspace, runId) }
      : await configFor(workspacePath, configPath);
    const id = runId ? `${workspace}:run:${runId}` : `${workspace}:workspace:${loaded.path}`;
    const digest = createHash('sha256').update(JSON.stringify(loaded.config)).digest('hex');
    const registered = registeredProviders.get(id);
    if (registered?.digest !== digest) {
      await registered?.dispose();
      const dispose = await capabilities.register(
        new ConfigResourceProvider(loaded.config, workspacePath, `${id}:${digest}`, {
          ...(runId ? { runCacheRoot: join(store.runDirectory(workspace, runId), 'cache', 'resources') } : {}),
        }),
        { workspaceId: workspace, ...(runId ? { runId } : {}) },
      );
      registeredProviders.set(id, { digest, dispose });
    }
    return loaded;
  }

  server.registerTool(
    'config_inspect',
    {
      description: 'Load Harness config and return its branch/worktree strategy, repository Context, Skills, and Node Definitions. Workflow and Stage fields are rejected.',
      inputSchema: z.object({ workspacePath: z.string(), configPath: z.string().optional() }),
    },
    async ({ workspacePath, configPath }) => {
      const loaded = await configFor(workspacePath, configPath);
      return result({
        configPath: loaded.path,
        version: loaded.config.version,
        strategy: loaded.config.strategy,
        nodes: availableNodes(loaded.config),
        context: Object.keys(loaded.config.context),
        skills: Object.keys(loaded.config.skills),
        sourceFiles: loaded.config.sourceFiles,
      });
    },
  );

  server.registerTool(
    'workspace_prepare',
    {
      description: 'Fetch the selected remote base, prepare or rebase one task branch using the configured branch/worktree strategy, and issue a receipt required by run_create.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        taskBranch: z.string().min(1),
        remote: z.string().min(1).optional(),
        baseBranch: z.string().min(1).optional(),
        worktreePath: z.string().min(1).optional(),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, configPath, taskBranch, remote, baseBranch, worktreePath, command }) => {
      const { config } = await configFor(workspacePath, configPath);
      return result(await new WorkspacePreparer().prepare({
        workspacePath,
        strategy: config.strategy,
        taskBranch,
        idempotencyKey: command.idempotencyKey,
        ...(remote ? { remote } : {}),
        ...(baseBranch ? { baseBranch } : {}),
        ...(worktreePath ? { worktreePath } : {}),
      }));
    },
  );

  server.registerTool(
    'run_create',
    {
      description: 'Create a durable Run and its first Commitment revision. Core allocates all identities and opens the acceptance Claims.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        workspacePreparationId: z.string().min(1),
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
    async ({ workspacePath, configPath, workspacePreparationId, request, hostSessionId, commitment }) => {
      const { config } = await configFor(workspacePath, configPath);
      await new WorkspacePreparer().verify(workspacePreparationId, workspacePath, config.strategy);
      const run = await new RunStore().createRun({
        workspacePath,
        request,
        config,
        commitment,
        workspacePreparationId,
        ...(hostSessionId ? { hostSessionId } : {}),
      });
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
    'run_list',
    {
      description: 'List active or archived Harness Runs across workspaces from the rebuildable global Run index.',
      inputSchema: z.object({ scope: z.enum(['all', 'active', 'archived']).default('all') }),
    },
    async ({ scope }) => result({ scope, runs: await new RunStore().listRuns(scope) }),
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
    phase: z.enum(PLAN_PHASES).optional(),
    dependsOn: z.array(z.string()).default([]),
    input: z.record(z.string(), z.unknown()).optional(),
    targetClaimIds: z.array(z.string()).refine((claimIds) => new Set(claimIds).size === claimIds.length, 'targetClaimIds must be unique').optional(),
  }).strict();

  server.registerTool(
    'plan_propose',
    {
      description: 'Propose the next immutable task-scoped Plan DAG against the active Commitment revision.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        commitmentRevision: z.number().int().positive(),
        nodes: z.array(plannedNodeSchema),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, commitmentRevision, nodes, command }) => {
      const id = await workspaceId(workspacePath);
      const store = new RunStore();
      const [config, projection] = await Promise.all([
        store.readConfigSnapshot(id, runId),
        store.getProjection(id, runId),
      ]);
      const commitment = projection.commitments[commitmentRevision];
      invariant(commitment, 'UNKNOWN_COMMITMENT', `Unknown Commitment revision ${commitmentRevision}`);
      const normalizedNodes = nodes.map((node): PlannedNode => {
        const definition = config.nodes[node.definitionId];
        invariant(definition, 'MISSING_NODE', `Unknown Node Definition '${node.definitionId}'`);
        for (const claimId of node.targetClaimIds ?? []) {
          invariant(commitment.acceptanceClaimIds.includes(claimId), 'UNREQUIRED_CLAIM', `Planned node '${node.id}' targets non-acceptance Claim '${claimId}'`);
        }
        const authority = definition.authority ?? [];
        for (const item of authority) {
          invariant(commitment.authority.includes(item), 'UNAUTHORIZED_PLAN_NODE', `Planned node '${node.id}' requests unauthorized capability '${item}'`);
        }
        assertPortValues(definition.inputs, node.input ?? {}, `Planned node '${node.id}' input`);
        return {
          id: node.id,
          definitionId: node.definitionId,
          ...(node.phase ? { phase: node.phase } : {}),
          dependsOn: node.dependsOn,
          authority,
          ...(node.input ? { input: node.input } : {}),
          ...(node.targetClaimIds ? { targetClaimIds: node.targetClaimIds } : {}),
        };
      });
      return result(await store.proposePlan(
        id,
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
      description: 'Return ready execution assignments with Planned Nodes resolved against the Run configuration snapshot.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string() }),
    },
    async ({ workspacePath, runId }) => result(await new RunStore().readyNodeAssignments(await workspaceId(workspacePath), runId)),
  );

  server.registerTool(
    'execution_start',
    {
      description: 'Start one ready Planned Node from the current assignment envelope. Core rejects stale Commitment or Plan revisions before allocating an execution.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        commitmentRevision: z.number().int().positive(),
        planRevision: z.number().int().positive(),
        plannedNodeId: z.string(),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, plannedNodeId, commitmentRevision, planRevision, command }) => result(
      await new RunStore().startExecution(
        await workspaceId(workspacePath),
        runId,
        plannedNodeId,
        commitmentRevision,
        planRevision,
        commandContext(command),
      ),
    ),
  );

  server.registerTool(
    'execution_retry',
    {
      description: 'Explicitly retry the latest failed, blocked, cancelled, or interrupted Node attempt using Evidence from that attempt.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        previousExecutionId: z.string(),
        commitmentRevision: z.number().int().positive(),
        planRevision: z.number().int().positive(),
        reason: z.string().min(1),
        evidenceIds: z.array(z.string()).min(1),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, previousExecutionId, commitmentRevision, planRevision, reason, evidenceIds, command }) => result(
      await new RunStore().retryExecution(
        await workspaceId(workspacePath),
        runId,
        previousExecutionId,
        commitmentRevision,
        planRevision,
        reason,
        evidenceIds,
        commandContext(command),
      ),
    ),
  );

  server.registerTool(
    'execution_finish',
    {
      description: 'Finish one running Node Execution exactly once with host-reported status, bounded structured output, Evidence identities, and immutable JSON or Markdown Exports. Command stdout and stderr belong in Evidence; declared outputs are submitted separately and validated.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        executionId: z.string(),
        status: z.enum(['blocked', 'succeeded', 'failed', 'cancelled', 'skipped', 'interrupted']),
        evidenceIds: z.array(z.string()).default([]),
        output: z.record(z.string(), z.unknown()).optional(),
        exports: z.array(z.object({
          name: z.string().min(1),
          mediaType: z.enum(['application/json', 'text/markdown']),
          role: z.string().min(1).optional(),
          content: z.string().optional(),
          sourcePath: z.string().min(1).optional(),
        }).refine((item) => (item.content !== undefined) !== (item.sourcePath !== undefined), {
          message: 'Provide exactly one of content or sourcePath',
        })).default([]),
        command: commandContextSchema,
      }),
    },
    async ({ workspacePath, runId, executionId, status, evidenceIds, output, exports, command }) => result(
      await new RunStore().finishExecution(
        await workspaceId(workspacePath),
        runId,
        executionId,
        status,
        evidenceIds,
        commandContext(command),
        output,
        exports.map((item) => ({
          name: item.name,
          mediaType: item.mediaType,
          ...(item.role !== undefined ? { role: item.role } : {}),
          ...(item.content !== undefined ? { content: item.content } : {}),
          ...(item.sourcePath !== undefined ? { sourcePath: item.sourcePath } : {}),
        })),
      ),
    ),
  );

  server.registerTool(
    'evidence_record',
    {
      description: 'Store digest-addressed Evidence bound to one Node Execution. Core derives the Commitment, Plan, Planned Node, and input digest from authoritative Run state.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        executionId: z.string(),
        content: z.string(),
        kind: z.string(),
        summary: z.string(),
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
        kind: z.enum(['skill', 'context', 'executor', 'host', 'approval', 'telemetry']).optional(),
      }),
    },
    async ({ workspacePath, configPath, kind, ...scope }) => {
      const loaded = await ensureCapabilities(workspacePath, configPath, scope.runId);
      const summaries = await capabilities.list(capabilityScope(await workspaceId(workspacePath), scope), kind);
      return result(scope.runId
        ? summaries.filter((summary) => summary.kind !== 'context' && summary.kind !== 'skill'
          || Boolean(summary.kind === 'context' ? loaded.config.context[summary.id] : loaded.config.skills[summary.id]))
        : summaries);
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
      const loaded = await ensureCapabilities(workspacePath, configPath, scope.runId);
      const id = await workspaceId(workspacePath);
      const targetScope = capabilityScope(id, scope);
      if (scope.runId && !loaded.config.context[capabilityId] && !loaded.config.skills[capabilityId]) {
        const summary = (await capabilities.list(targetScope)).find((candidate) => candidate.id === capabilityId);
        invariant(summary && summary.kind !== 'context' && summary.kind !== 'skill', 'CAPABILITY_NOT_IN_RUN_CONFIG', `Resource '${capabilityId}' is absent from Run '${scope.runId}' configuration snapshot`);
      }
      const receipt = await capabilities.activate({ capabilityId, mode, scope: targetScope, idempotencyKey: command.idempotencyKey });
      if (scope.runId) await new RunStore().recordResourceActivation(id, scope.runId, capabilityId, receipt.digest, commandContext(command), receipt.revision);
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

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const configuredPort = Number.parseInt(process.env.DEWEYOU_DASHBOARD_PORT ?? '7777', 10);
  const dashboard = process.env.DEWEYOU_DASHBOARD_AUTOSTART === '0'
    ? undefined
    : await maintainDashboardServer({
      port: Number.isInteger(configuredPort) ? configuredPort : 7777,
      onError: (error) => console.error('Harness Dashboard server error:', error),
    });
  await serveStdio(() => createHarnessServer());
  if (dashboard) {
    const closeDashboard = () => {
      void dashboard.close().catch((error) => console.error('Harness Dashboard shutdown error:', error));
    };
    process.stdin.once('end', closeDashboard);
    process.once('SIGINT', closeDashboard);
    process.once('SIGTERM', closeDashboard);
    if (process.stdin.readableEnded) await dashboard.close();
  }
}
