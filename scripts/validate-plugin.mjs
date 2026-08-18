import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
for (const field of ['name', 'version', 'description']) {
  if (typeof manifest[field] !== 'string' || manifest[field].length === 0)
    throw new Error(`plugin.json requires ${field}`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error('plugin.json version must be strict semver');
if (
  !manifest.author?.name ||
  !manifest.interface?.displayName ||
  !manifest.interface?.shortDescription ||
  !manifest.interface?.longDescription
) {
  throw new Error('plugin.json is missing required author or interface metadata');
}
for (const path of [manifest.skills, manifest.mcpServers]) {
  if (typeof path !== 'string' || !path.startsWith('./'))
    throw new Error(`Invalid plugin component path: ${path}`);
  await access(path);
}
const mcp = JSON.parse(await readFile(manifest.mcpServers, 'utf8'));
const server = mcp.mcpServers?.['deweyou-harness'];
if (server?.command !== 'node' || server?.args?.[0] !== '${CLAUDE_PLUGIN_ROOT}/dist/server.mjs') {
  throw new Error(
    'Codex and Claude must resolve the bundled MCP server from the compatible plugin root',
  );
}

const claudeManifest = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8'));
const claudeMarketplace = JSON.parse(await readFile('.claude-plugin/marketplace.json', 'utf8'));
const claudeMcp = JSON.parse(await readFile('.mcp.json', 'utf8'));
if (claudeManifest.name !== manifest.name || claudeManifest.version !== manifest.version) {
  throw new Error('Claude plugin identity must match the Codex plugin identity');
}
if (
  claudeMarketplace.plugins?.[0]?.name !== manifest.name ||
  claudeMarketplace.plugins?.[0]?.source !== './'
) {
  throw new Error('Claude marketplace must expose the repository-root plugin');
}
if (
  claudeMcp.mcpServers?.['deweyou-harness']?.args?.[0] !== '${CLAUDE_PLUGIN_ROOT}/dist/server.mjs'
) {
  throw new Error('Claude MCP server must resolve the bundle from CLAUDE_PLUGIN_ROOT');
}

const portableManifest = JSON.parse(await readFile('plugin.json', 'utf8'));
const portableMcp = JSON.parse(await readFile('mcp.json', 'utf8'));
if (
  portableManifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' ||
  portableManifest.name !== manifest.name ||
  portableManifest.version !== manifest.version
) {
  throw new Error('Portable Agent Plugin manifest is invalid or out of sync');
}
if (
  portableMcp.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' ||
  portableMcp.mcpServers?.['deweyou-harness']?.args?.[0] !== '${PLUGIN_ROOT}/dist/server.mjs' ||
  portableMcp.mcpServers?.['deweyou-harness']?.cwd !== '${PLUGIN_ROOT}'
) {
  throw new Error('Portable Agent Plugin MCP server must resolve the bundle from PLUGIN_ROOT');
}

const traeManifest = JSON.parse(await readFile('.trae-plugin/plugin.json', 'utf8'));
const traeMcp = JSON.parse(await readFile('.trae-mcp.json', 'utf8'));
if (
  traeManifest.name !== manifest.name ||
  traeManifest.version !== manifest.version ||
  traeManifest.skills !== './skills/' ||
  traeManifest.mcp !== '.trae-mcp.json' ||
  !traeManifest.interface?.displayName ||
  !traeManifest.interface?.defaultPrompt?.length ||
  traeManifest.interface?.composerIcon !== './assets/harness-small.svg' ||
  traeManifest.interface?.logo !== './assets/harness.png'
) {
  throw new Error('Trae plugin identity, skill root, MCP config, or interface metadata is invalid');
}
if (
  traeMcp.mcpServers?.['deweyou-harness']?.type !== 'stdio' ||
  traeMcp.mcpServers?.['deweyou-harness']?.command !== 'node' ||
  traeMcp.mcpServers?.['deweyou-harness']?.args?.[0] !== './dist/server.mjs' ||
  traeMcp.mcpServers?.['deweyou-harness']?.cwd !== '.'
) {
  throw new Error('Trae MCP server must use plugin-root-relative paths without host variables');
}
await access('skills/dhw/agents/openai.yaml');
await access('assets/harness-small.svg');
await access('assets/harness.png');
await access('skills/dhw/assets/dhw-small.svg');
await access('skills/dhw/assets/dhw.png');

const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const openClawManifest = JSON.parse(await readFile('openclaw.plugin.json', 'utf8'));
if (
  openClawManifest.id !== manifest.name ||
  openClawManifest.version !== manifest.version ||
  openClawManifest.skills?.[0] !== './skills' ||
  packageManifest.openclaw?.extensions?.[0] !== './adapters/openclaw/index.mjs'
) {
  throw new Error('OpenClaw plugin identity, skill root, or runtime entry is invalid');
}
if (
  openClawManifest.mcpServers?.['deweyou-harness']?.transport !== 'stdio' ||
  openClawManifest.mcpServers?.['deweyou-harness']?.command !== 'node' ||
  openClawManifest.mcpServers?.['deweyou-harness']?.args?.[0] !== './dist/server.mjs' ||
  openClawManifest.mcpServers?.['deweyou-harness']?.cwd !== '.'
) {
  throw new Error('OpenClaw must resolve the bundled MCP server from the plugin root');
}
if (
  openClawManifest.configSchema?.type !== 'object' ||
  openClawManifest.configSchema?.additionalProperties !== false
) {
  throw new Error('OpenClaw plugin must declare a closed configuration schema');
}
await access(packageManifest.openclaw.extensions[0]);

const codexMarketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
const codexEntry = codexMarketplace.plugins?.[0];
if (
  codexEntry?.name !== manifest.name ||
  codexEntry?.source?.source !== 'local' ||
  codexEntry?.source?.path !== './' ||
  codexEntry?.policy?.installation !== 'AVAILABLE' ||
  codexEntry?.policy?.authentication !== 'ON_INSTALL'
) {
  throw new Error('Codex marketplace must expose the repository-root plugin with explicit policy');
}
await access('dist/server.mjs');
const serverBundle = await readFile('dist/server.mjs', 'utf8');
const importSpecifiers = serverBundle
  .split('\n')
  .filter((line) => line.startsWith('import '))
  .map((line) => /(?:from\s+)?["']([^"']+)["'];?\s*$/.exec(line)?.[1])
  .filter(Boolean);
const externalImports = importSpecifiers.filter((specifier) => !specifier.startsWith('node:'));
if (externalImports.length > 0) {
  throw new Error(`Bundled MCP server has external imports: ${[...new Set(externalImports)].join(', ')}`);
}
console.log(
  'Cross-agent plugin asset validation passed for Codex, Claude Code, Cursor, Trae, OpenClaw, and Hermes Agent.',
);
