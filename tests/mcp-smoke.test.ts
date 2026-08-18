import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
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
    const client = new Client({ name: 'harness-test', version: '0.1.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: ['server.mjs'],
        cwd: isolatedPluginRoot,
        stderr: 'pipe',
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'config_inspect',
        'event_append',
        'evidence_record',
        'proposal_decide',
        'ready_nodes',
        'resources_dispatch',
        'retrospective_get',
        'run_create',
        'run_get',
        'run_rehydrate',
      ].sort(),
    );
  });
});
