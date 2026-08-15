import { lstat, readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

describe('Codex plugin package', () => {
  test('exposes only dhw as its bundled skill and a local bundled MCP server', async () => {
    const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
    const mcp = JSON.parse(await readFile('.mcp.json', 'utf8'));
    expect(manifest).toMatchObject({ name: 'deweyou-harness', version: '0.1.0', skills: './skills/', mcpServers: './.mcp.json' });
    expect(mcp.mcpServers['deweyou-harness']).toEqual({ command: 'node', args: ['./dist/server.mjs'], cwd: '.' });
    await expect(readFile('skills/dhw/SKILL.md', 'utf8')).resolves.toContain('name: dhw');
    await expect(lstat('CLAUDE.md')).resolves.toMatchObject({});
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
