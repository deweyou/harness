import { lstat, readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const packageVersion = JSON.parse(await readFile('package.json', 'utf8')).version;

describe('cross-agent plugin package', () => {
  test('exposes only dhw and the bundled MCP server to Codex', async () => {
    const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
    const mcp = JSON.parse(await readFile('.mcp.json', 'utf8'));
    expect(manifest).toMatchObject({
      name: 'deweyou-harness',
      version: packageVersion,
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(mcp.mcpServers['deweyou-harness']).toEqual({
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/dist/server.mjs'],
    });
    await expect(readFile('skills/dhw/SKILL.md', 'utf8')).resolves.toContain('name: dhw');
    await expect(lstat('CLAUDE.md')).resolves.toMatchObject({});
  });

  test('exposes the same identity and bundle to Claude Code', async () => {
    const manifest = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8'));
    const marketplace = JSON.parse(await readFile('.claude-plugin/marketplace.json', 'utf8'));
    const mcp = JSON.parse(await readFile('.mcp.json', 'utf8'));
    expect(manifest).toMatchObject({ name: 'deweyou-harness', version: packageVersion });
    expect(marketplace).toMatchObject({
      name: 'deweyou',
      plugins: [{ name: 'deweyou-harness', source: './', version: packageVersion }],
    });
    expect(mcp.mcpServers['deweyou-harness']).toEqual({
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/dist/server.mjs'],
    });
  });

  test('provides a portable Agent Plugin for Cursor and Hermes Agent', async () => {
    const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
    const mcp = JSON.parse(await readFile('mcp.json', 'utf8'));
    expect(manifest).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'deweyou-harness',
      version: packageVersion,
    });
    expect(mcp).toMatchObject({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        'deweyou-harness': {
          type: 'stdio',
          command: 'node',
          args: ['${PLUGIN_ROOT}/dist/server.mjs'],
          cwd: '${PLUGIN_ROOT}',
        },
      },
    });
  });

  test('provides an OpenClaw plugin over the shared skill and MCP bundle', async () => {
    const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
    const manifest = JSON.parse(await readFile('openclaw.plugin.json', 'utf8'));
    expect(packageManifest.openclaw).toEqual({
      extensions: ['./adapters/openclaw/index.mjs'],
    });
    expect(manifest).toMatchObject({
      id: 'deweyou-harness',
      version: packageVersion,
      skills: ['./skills'],
      mcpServers: {
        'deweyou-harness': {
          transport: 'stdio',
          command: 'node',
          args: ['./dist/server.mjs'],
          cwd: '.',
        },
      },
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    });
    await expect(readFile('adapters/openclaw/index.mjs', 'utf8')).resolves.toContain(
      'registerDeweyouHarness',
    );
    const skill = await readFile('skills/dhw/SKILL.md', 'utf8');
    expect(skill.split('---')[1]).toContain('user-invocable: true');
  });

  test('publishes installable Codex marketplace metadata', async () => {
    const marketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
    expect(marketplace).toMatchObject({
      name: 'deweyou',
      plugins: [
        {
          name: 'deweyou-harness',
          source: { source: 'local', path: './' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Productivity',
        },
      ],
    });
  });

  test('documents the new state root without executable legacy state references', async () => {
    const sources = await Promise.all([
      readFile('src/core/state/store.ts', 'utf8'),
      readFile('skills/dhw/SKILL.md', 'utf8'),
      readFile('docs/harness-core.md', 'utf8'),
    ]);
    expect(sources[0]).toContain("'.deweyou', 'harness'");
    expect(sources[0]).not.toContain("'.deweyou', 'dev'");
    expect(sources[1]).not.toContain('deweyou-cli');
    expect(sources[2]).toContain('Old `~/.deweyou/dev/` state is intentionally ignored');
  });
});
