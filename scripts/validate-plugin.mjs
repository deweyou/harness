import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
for (const field of ['name', 'version', 'description']) {
  if (typeof manifest[field] !== 'string' || manifest[field].length === 0) throw new Error(`plugin.json requires ${field}`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('plugin.json version must be strict semver');
if (!manifest.author?.name || !manifest.interface?.displayName || !manifest.interface?.shortDescription || !manifest.interface?.longDescription) {
  throw new Error('plugin.json is missing required author or interface metadata');
}
for (const path of [manifest.skills, manifest.mcpServers]) {
  if (typeof path !== 'string' || !path.startsWith('./')) throw new Error(`Invalid plugin component path: ${path}`);
  await access(path);
}
const mcp = JSON.parse(await readFile(manifest.mcpServers, 'utf8'));
const server = mcp.mcpServers?.['deweyou-harness'];
if (server?.command !== 'node' || server?.args?.[0] !== './dist/server.mjs' || server?.cwd !== '.') {
  throw new Error('Plugin MCP server must use the bundled local stdio entrypoint');
}
await access('dist/server.mjs');
console.log('Plugin package validation passed.');
