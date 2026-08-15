import { readFile } from 'node:fs/promises';

const requiredFiles = [
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'skills/dhw/SKILL.md',
  'skills/dhw/README.md',
  'skills/dhw/README_ZH.md',
  'skills/dhw/evals/evals.json',
  'schemas/harness.schema.json',
  'schemas/event.schema.json',
  'schemas/run.schema.json',
  'schemas/resource-proposal.schema.json',
  'schemas/retrospective.schema.json',
];

for (const path of requiredFiles) {
  const content = await readFile(path, 'utf8');
  if (path.endsWith('.json')) JSON.parse(content);
}

const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
if (manifest.name !== 'deweyou-harness' || manifest.skills !== './skills/' || manifest.mcpServers !== './.mcp.json') {
  throw new Error('Plugin manifest does not expose the expected Harness components');
}

const skill = await readFile('skills/dhw/SKILL.md', 'utf8');
if (!skill.startsWith('---\nname: dhw\n') || !skill.includes('\ndescription:')) {
  throw new Error('skills/dhw/SKILL.md must have dhw frontmatter');
}

const evals = JSON.parse(await readFile('skills/dhw/evals/evals.json', 'utf8'));
if (evals.skill_name !== 'dhw' || !Array.isArray(evals.evals) || evals.evals.length === 0) {
  throw new Error('dhw evals must be present');
}

console.log('Harness plugin assets are valid.');
