import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { createHarnessServer } from '../src/mcp/server.js';

const clients: Client[] = [];
const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((value) => value.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Harness MCP server', () => {
  test('completes an MCP handshake and exposes the deterministic control tools', async () => {
    expect(createHarnessServer()).toBeDefined();
    const isolatedPluginRoot = await mkdtemp(join(tmpdir(), 'harness-bundle-'));
    const remote = await mkdtemp(join(tmpdir(), 'harness-bundle-remote-'));
    const preparedWorkspace = await mkdtemp(join(tmpdir(), 'harness-bundle-worktree-'));
    await rm(preparedWorkspace, { recursive: true, force: true });
    const stateRoot = await mkdtemp(join(tmpdir(), 'harness-bundle-state-'));
    temporaryDirectories.push(isolatedPluginRoot, remote, preparedWorkspace, stateRoot);
    await copyFile('dist/server.mjs', join(isolatedPluginRoot, 'server.mjs'));
    await writeFile(join(isolatedPluginRoot, 'AGENTS.md'), '# Repository context v1\n');
    await writeFile(join(isolatedPluginRoot, 'harness.yaml'), 'version: 3\nstrategy: worktree\ncontext:\n  repository:\n    source: { entry: AGENTS.md }\nnodes:\n  work:\n    kind: agent\n    description: Perform one bounded work item.\n    inputs:\n      task:\n        type: string\n        description: Work to perform.\n    authority: [read-workspace]\n');
    await execFileAsync('git', ['init', '--bare'], { cwd: remote });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: isolatedPluginRoot });
    await execFileAsync('git', ['add', 'harness.yaml', 'AGENTS.md'], { cwd: isolatedPluginRoot });
    await execFileAsync('git', ['-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'initial'], { cwd: isolatedPluginRoot });
    await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: isolatedPluginRoot });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: isolatedPluginRoot });
    await execFileAsync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: remote });
    await execFileAsync('git', ['remote', 'set-head', 'origin', 'main'], { cwd: isolatedPluginRoot });
    const client = new Client({ name: 'harness-test', version: '0.1.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: ['server.mjs'],
        cwd: isolatedPluginRoot,
        env: { ...process.env, HOME: isolatedPluginRoot, DEWEYOU_HARNESS_STATE_ROOT: stateRoot, DEWEYOU_DASHBOARD_AUTOSTART: '0' } as Record<string, string>,
        stderr: 'pipe',
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'capabilities_list',
        'capability_activate',
        'claim_update',
        'commitment_revise',
        'config_inspect',
        'evidence_record',
        'execution_finish',
        'execution_retry',
        'execution_start',
        'plan_activate',
        'plan_propose',
        'proposal_decide',
        'ready_nodes',
        'resource_feedback_record',
        'retrospective_get',
        'run_complete',
        'run_create',
        'run_get',
        'run_list',
        'workspace_prepare',
      ].sort(),
    );
    const inspected = await client.callTool({ name: 'config_inspect', arguments: { workspacePath: isolatedPluginRoot } });
    expect(inspected.structuredContent).toMatchObject({
      version: 3,
      strategy: 'worktree',
      nodes: [{ id: 'work', kind: 'agent', description: 'Perform one bounded work item.', skill: [], authority: ['read-workspace'] }],
    });
    const prepared = await client.callTool({
      name: 'workspace_prepare',
      arguments: {
        workspacePath: isolatedPluginRoot,
        taskBranch: 'codex/mcp-smoke',
        baseBranch: 'main',
        worktreePath: preparedWorkspace,
        command: { idempotencyKey: 'prepare-mcp-smoke' },
      },
    });
    const receipt = prepared.structuredContent as { id: string; preparedWorkspacePath: string };
    const created = await client.callTool({
      name: 'run_create',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        workspacePreparationId: receipt.id,
        request: { prompt: 'work' },
        commitment: {
          objective: 'Do the work',
          scope: ['workspace'],
          authority: ['read-workspace'],
          destination: 'user',
          acceptance: [{ description: 'Work is verified' }],
        },
      },
    });
    expect(created.structuredContent).toMatchObject({
      run: { schemaVersion: 2, workspacePreparationId: receipt.id },
      projection: { activeCommitmentRevision: 1, status: 'running' },
    });
    const createdContent = created.structuredContent as {
      run: { id: string };
      projection: { commitments: Record<number, { acceptanceClaimIds: string[] }> };
    };
    const acceptanceClaimId = createdContent.projection.commitments[1]!.acceptanceClaimIds[0]!;

    await writeFile(join(receipt.preparedWorkspacePath, 'harness.yaml'), 'version: 3\nstrategy: worktree\ncontext:\n  live-only:\n    source: { entry: AGENTS.md }\nnodes:\n  replacement:\n    kind: agent\n    description: Replacement live node.\n');

    const proposed = await client.callTool({
      name: 'plan_propose',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: createdContent.run.id,
        commitmentRevision: 1,
        nodes: [{ id: 'work-1', definitionId: 'work', input: { task: 'perform work' }, targetClaimIds: [acceptanceClaimId] }],
        command: { idempotencyKey: 'plan-inherited-authority' },
      },
    });
    expect(proposed.structuredContent).toMatchObject({
      nodes: [{ id: 'work-1', definitionId: 'work', authority: ['read-workspace'] }],
    });
    await client.callTool({
      name: 'plan_activate',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: createdContent.run.id,
        planRevision: (proposed.structuredContent as { revision: number }).revision,
        command: { idempotencyKey: 'activate-plan-assignment' },
      },
    });
    const ready = await client.callTool({
      name: 'ready_nodes',
      arguments: { workspacePath: receipt.preparedWorkspacePath, runId: createdContent.run.id },
    });
    expect(ready.structuredContent).toEqual({
      runId: createdContent.run.id,
      workspace: expect.objectContaining({ id: expect.any(String), path: receipt.preparedWorkspacePath }),
      commitmentRevision: 1,
      planRevision: (proposed.structuredContent as { revision: number }).revision,
      assignments: [{
        plannedNode: expect.objectContaining({ id: 'work-1', definitionId: 'work', input: { task: 'perform work' } }),
        definition: {
          kind: 'agent',
          description: 'Perform one bounded work item.',
          inputs: { task: { type: 'string', description: 'Work to perform.' } },
          authority: ['read-workspace'],
        },
      }],
    });
    const staleStart = await client.callTool({
      name: 'execution_start',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: createdContent.run.id,
        commitmentRevision: 1,
        planRevision: 999,
        plannedNodeId: 'work-1',
        command: { idempotencyKey: 'stale-mcp-execution-start' },
      },
    });
    expect(staleStart).toMatchObject({ isError: true });
    expect(staleStart.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('active Plan revision') }),
    ]));
    const started = await client.callTool({
      name: 'execution_start',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: createdContent.run.id,
        commitmentRevision: 1,
        planRevision: (proposed.structuredContent as { revision: number }).revision,
        plannedNodeId: 'work-1',
        command: { idempotencyKey: 'current-mcp-execution-start' },
      },
    });
    expect(started.structuredContent).toMatchObject({ attempt: 1, executionId: expect.any(String) });

    const authorityOverride = await client.callTool({
      name: 'plan_propose',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: createdContent.run.id,
        commitmentRevision: 1,
        nodes: [{ id: 'work-1', definitionId: 'work', input: { task: 'perform work' }, authority: [] }],
        command: { idempotencyKey: 'plan-authority-override' },
      },
    });
    expect(authorityOverride).toMatchObject({ isError: true });
    expect(authorityOverride.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('Input validation error') }),
    ]));

    const duplicatedOutputs = await client.callTool({
      name: 'plan_propose',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: createdContent.run.id,
        commitmentRevision: 1,
        nodes: [{ id: 'work-2', definitionId: 'work', input: { task: 'perform work' }, expectedOutputs: ['result'] }],
        command: { idempotencyKey: 'plan-duplicate-outputs' },
      },
    });
    expect(duplicatedOutputs).toMatchObject({ isError: true });

    const invalidInput = await client.callTool({
      name: 'plan_propose',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: (created.structuredContent as { run: { id: string } }).run.id,
        commitmentRevision: 1,
        nodes: [{ id: 'work-3', definitionId: 'work', input: { task: 3 } }],
        command: { idempotencyKey: 'plan-invalid-input' },
      },
    });
    expect(invalidInput).toMatchObject({ isError: true });

    const liveCapabilities = await client.callTool({
      name: 'capabilities_list',
      arguments: { workspacePath: receipt.preparedWorkspacePath, kind: 'context' },
    });
    expect(liveCapabilities.structuredContent).toEqual({
      result: [{ id: 'live-only', kind: 'context', description: 'live-only' }],
    });
    const runCapabilities = await client.callTool({
      name: 'capabilities_list',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: (created.structuredContent as { run: { id: string } }).run.id,
        kind: 'context',
      },
    });
    expect(runCapabilities.structuredContent).toEqual({
      result: [{ id: 'repository', kind: 'context', description: 'repository' }],
    });
    const liveOnlyActivation = await client.callTool({
      name: 'capability_activate',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: (created.structuredContent as { run: { id: string } }).run.id,
        capabilityId: 'live-only',
        mode: 'full',
        command: { idempotencyKey: 'reject-live-only-context' },
      },
    });
    expect(liveOnlyActivation).toMatchObject({ isError: true });

    const firstContext = await client.callTool({
      name: 'capability_activate',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: (created.structuredContent as { run: { id: string } }).run.id,
        capabilityId: 'repository',
        mode: 'full',
        command: { idempotencyKey: 'activate-run-context-v1' },
      },
    });
    expect(firstContext.structuredContent).toMatchObject({ content: '# Repository context v1\n' });
    await writeFile(join(receipt.preparedWorkspacePath, 'AGENTS.md'), '# Repository context v2\n');
    const pinnedContext = await client.callTool({
      name: 'capability_activate',
      arguments: {
        workspacePath: receipt.preparedWorkspacePath,
        runId: (created.structuredContent as { run: { id: string } }).run.id,
        capabilityId: 'repository',
        mode: 'full',
        command: { idempotencyKey: 'activate-run-context-v2' },
      },
    });
    expect(pinnedContext.structuredContent).toMatchObject({
      content: '# Repository context v1\n',
      digest: (firstContext.structuredContent as { digest: string }).digest,
    });
  });
});
