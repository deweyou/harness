import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createHarnessServer } from '../src/mcp/server.js';

const clients: Client[] = [];
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
    temporaryDirectories.push(isolatedPluginRoot);
    await copyFile('dist/server.mjs', join(isolatedPluginRoot, 'server.mjs'));
    await writeFile(join(isolatedPluginRoot, 'harness.yaml'), 'version: 2\nnodes:\n  work:\n    executor: { kind: agent }\n');
    const client = new Client({ name: 'harness-test', version: '0.1.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: ['server.mjs'],
        cwd: isolatedPluginRoot,
        env: { ...process.env, HOME: isolatedPluginRoot } as Record<string, string>,
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
      ].sort(),
    );
    const inspected = await client.callTool({ name: 'config_inspect', arguments: { workspacePath: isolatedPluginRoot } });
    expect(inspected.structuredContent).toMatchObject({ version: 2, nodes: [{ id: 'work' }] });
    const created = await client.callTool({
      name: 'run_create',
      arguments: {
        workspacePath: isolatedPluginRoot,
        request: { prompt: 'work' },
        commitment: {
          objective: 'Do the work',
          scope: ['workspace'],
          authority: [],
          destination: 'user',
          acceptance: [{ description: 'Work is verified' }],
        },
      },
    });
    expect(created.structuredContent).toMatchObject({
      run: { schemaVersion: 2 },
      projection: { activeCommitmentRevision: 1, status: 'running' },
    });
  });
});
