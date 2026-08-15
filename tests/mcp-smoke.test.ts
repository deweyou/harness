import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, test } from 'vitest';
import { createHarnessServer } from '../src/mcp/server.js';

const clients: Client[] = [];
afterEach(async () => Promise.all(clients.splice(0).map((value) => value.close())));

describe('Harness MCP server', () => {
  test('completes an MCP handshake and exposes the deterministic control tools', async () => {
    expect(createHarnessServer()).toBeDefined();
    const client = new Client({ name: 'harness-test', version: '0.1.0' });
    clients.push(client);
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: ['dist/server.mjs'],
        cwd: process.cwd(),
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
