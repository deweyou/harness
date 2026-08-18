#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { loadHarnessConfig, selectableWorkflows } from '../core/config/load.js';
import { dispatchNodeSkills, dispatchResource, dispatchWorkflowContext } from '../core/resources.js';
import { buildRehydrationPlan, readyWorkflowNodes } from '../core/runtime.js';
import { findConfig, RunStore } from '../core/state/store.js';
import { STAGES } from '../core/types.js';

const VERSION = '0.1.0';
const eventTypes = [
  'run.created',
  'workflow.selected',
  'stage.started',
  'stage.completed',
  'node.ready',
  'node.started',
  'node.succeeded',
  'node.failed',
  'node.blocked',
  'node.cancelled',
  'node.skipped',
  'node.interrupted',
  'resource.activated',
  'resource.feedback.recorded',
  'evidence.recorded',
  'decision.recorded',
  'run.completed',
  'retrospective.generated',
  'resource.change.proposed',
  'resource.change.accepted',
  'resource.change.rejected',
] as const;

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

async function configFor(workspacePath: string, configPath?: string) {
  const path = configPath ? resolve(workspacePath, configPath) : await findConfig(workspacePath);
  return { path, config: await loadHarnessConfig(path) };
}

export function createHarnessServer(): McpServer {
  const server = new McpServer({ name: 'deweyou-harness', version: VERSION });

  server.registerTool(
    'config_inspect',
    {
      description: 'Load and validate harness.yaml, imports, workflow inheritance, resource references, and stage DAGs.',
      inputSchema: z.object({ workspacePath: z.string(), configPath: z.string().optional() }),
    },
    async ({ workspacePath, configPath }) => {
      const loaded = await configFor(workspacePath, configPath);
      return result({ configPath: loaded.path, workflows: selectableWorkflows(loaded.config), sourceFiles: loaded.config.sourceFiles });
    },
  );

  server.registerTool(
    'run_create',
    {
      description: 'Create a durable Harness Run bundle after the controller has selected a workflow.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        workflowId: z.string(),
        request: z.record(z.string(), z.unknown()),
        hostSessionId: z.string().optional(),
      }),
    },
    async ({ workspacePath, configPath, workflowId, request, hostSessionId }) => {
      const { config } = await configFor(workspacePath, configPath);
      const metadata = await new RunStore().createRun({
        workspacePath,
        workflowId,
        request,
        config,
        ...(hostSessionId ? { hostSessionId } : {}),
      });
      return result(metadata);
    },
  );

  server.registerTool(
    'run_get',
    {
      description: 'Read and verify the authoritative event chain, then rebuild the Run projection.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        recoverInterrupted: z.boolean().default(false),
        hostSessionId: z.string().optional(),
      }),
    },
    async ({ workspacePath, runId, recoverInterrupted, hostSessionId }) => {
      const store = new RunStore();
      const workspaceId = await RunStore.workspaceId(workspacePath);
      if (hostSessionId) await store.attachHostSession(workspaceId, runId, hostSessionId);
      const projection = recoverInterrupted
        ? await store.recoverInterrupted(workspaceId, runId, randomUUID())
        : await store.rebuildProjection(workspaceId, runId);
      return result(projection);
    },
  );

  server.registerTool(
    'event_append',
    {
      description: 'Append one validated, hash-chained lifecycle event. Repeated attempts always use new nodeExecutionId values.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        type: z.enum(eventTypes),
        traceId: z.string(),
        spanId: z.string(),
        parentSpanId: z.string().optional(),
        idempotencyKey: z.string().optional(),
        timestamp: z.string().optional(),
        payload: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ workspacePath, runId, parentSpanId, idempotencyKey, timestamp, ...required }) => {
      const workspaceId = await RunStore.workspaceId(workspacePath);
      const input = {
        ...required,
        ...(parentSpanId ? { parentSpanId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(timestamp ? { timestamp } : {}),
      };
      return result(await new RunStore().appendEvent(workspaceId, runId, input));
    },
  );

  server.registerTool(
    'retrospective_get',
    {
      description: 'Read the automatic post-delivery retrospective and its actionable resource improvement proposals.',
      inputSchema: z.object({ workspacePath: z.string(), runId: z.string() }),
    },
    async ({ workspacePath, runId }) => {
      const workspaceId = await RunStore.workspaceId(workspacePath);
      return result(await new RunStore().getRetrospective(workspaceId, runId));
    },
  );

  server.registerTool(
    'proposal_decide',
    {
      description: 'Record the user decision for a resource proposal. Acceptance authorizes a separate maintenance Run, not direct mutation.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        proposalId: z.string(),
        decision: z.enum(['accepted', 'rejected']),
        traceId: z.string(),
        spanId: z.string(),
        reason: z.string().optional(),
      }),
    },
    async ({ workspacePath, runId, proposalId, decision, traceId, spanId, reason }) => {
      const workspaceId = await RunStore.workspaceId(workspacePath);
      return result(
        await new RunStore().decideProposal(
          workspaceId,
          runId,
          proposalId,
          decision,
          traceId,
          spanId,
          reason,
        ),
      );
    },
  );

  server.registerTool(
    'ready_nodes',
    {
      description: 'Return all currently ready same-stage DAG nodes so the controller can dispatch independent nodes in parallel.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        workflowId: z.string(),
        stage: z.enum(STAGES),
        completed: z.array(z.string()).default([]),
        started: z.array(z.string()).default([]),
      }),
    },
    async ({ workspacePath, configPath, workflowId, stage, completed, started }) => {
      const { config } = await configFor(workspacePath, configPath);
      return result(readyWorkflowNodes(config, workflowId, stage, new Set(completed), new Set(started)));
    },
  );

  server.registerTool(
    'resources_dispatch',
    {
      description: 'Progressively load workflow rules, knowledge metadata, node skills, or an explicitly requested resource.',
      inputSchema: z.discriminatedUnion('scope', [
        z.object({
          scope: z.literal('workflow'),
          workspacePath: z.string(),
          configPath: z.string().optional(),
          workflowId: z.string(),
          runId: z.string().optional(),
        }),
        z.object({ scope: z.literal('node'), workspacePath: z.string(), configPath: z.string().optional(), nodeId: z.string(), runId: z.string().optional() }),
        z.object({
          scope: z.literal('resource'),
          workspacePath: z.string(),
          configPath: z.string().optional(),
          resourceId: z.string(),
          mode: z.enum(['full', 'metadata']),
          runId: z.string().optional(),
        }),
      ]),
    },
    async (input) => {
      const { config } = await configFor(input.workspacePath, input.configPath);
      const receipts = input.scope === 'workflow'
        ? await dispatchWorkflowContext(config, input.workflowId, input.workspacePath)
        : input.scope === 'node'
          ? await dispatchNodeSkills(config, input.nodeId, input.workspacePath)
          : [await dispatchResource(config, input.resourceId, input.mode, input.workspacePath)];
      if (input.runId) {
        const workspaceId = await RunStore.workspaceId(input.workspacePath);
        await new RunStore().updateResourceLock(workspaceId, input.runId, receipts);
      }
      return result(receipts);
    },
  );

  server.registerTool(
    'run_rehydrate',
    {
      description: 'Build the mandatory resource redispatch plan after compaction, handoff, or resume.',
      inputSchema: z.object({
        workspacePath: z.string(),
        configPath: z.string().optional(),
        workflowId: z.string(),
        currentNodeIds: z.array(z.string()).default([]),
        activatedResources: z.array(z.string()).default([]),
      }),
    },
    async ({ workspacePath, configPath, workflowId, currentNodeIds, activatedResources }) => {
      const { config } = await configFor(workspacePath, configPath);
      return result(buildRehydrationPlan(config, workflowId, currentNodeIds, activatedResources));
    },
  );

  server.registerTool(
    'evidence_record',
    {
      description: 'Persist content-addressed evidence and append its lifecycle event without recording secrets or raw unrelated chat.',
      inputSchema: z.object({
        workspacePath: z.string(),
        runId: z.string(),
        traceId: z.string(),
        spanId: z.string(),
        content: z.string(),
        summary: z.string(),
      }),
    },
    async ({ workspacePath, runId, traceId, spanId, content, summary }) => {
      const store = new RunStore();
      const workspaceId = await RunStore.workspaceId(workspacePath);
      const evidence = await store.writeEvidence(workspaceId, runId, content);
      await store.appendEvent(workspaceId, runId, {
        type: 'evidence.recorded',
        traceId,
        spanId,
        payload: { evidenceId: evidence.evidenceId, summary, path: evidence.path },
      });
      return result(evidence);
    },
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serveStdio(() => createHarnessServer());
}
