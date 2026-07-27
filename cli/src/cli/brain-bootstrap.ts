import { loadBrainConfig } from './brain-config.ts'
import { BRAIN_AGENTS, type BrainAgent } from './brain-types.ts'

export async function renderBrainBootstrapPrompt({
  homeDir,
  agent,
}: {
  homeDir?: string
  agent: BrainAgent | string
}): Promise<string> {
  const selectedAgent = parseAgent(agent)
  const config = await loadBrainConfig({ homeDir })
  const displayName = agentDisplayName(selectedAgent)
  return `# Initialize Deweyou Context Hub in ${displayName}

Use your current model and the context already available in this agent. Do not
start a separate model process.

1. Run \`deweyou-cli brain status\` and inspect the existing knowledge repository
   at \`${config.knowledge_repo}\`. Preserve all existing content.
2. Install or verify only this adapter:
   \`deweyou-cli brain hook install --agent ${selectedAgent}\`
3. Review the current conversation and existing durable Claims. If this session
   contains a lasting preference, decision, project fact, or reusable lesson,
   capture only a concise summary:
   \`deweyou-cli brain capture --agent ${selectedAgent} --event bootstrap --data '<json>'\`
4. Run \`deweyou-cli brain maintain --agent ${selectedAgent}\` and follow the
   returned maintenance instructions. Submit model output only through
   \`deweyou-cli brain apply --data '<proposal-json>'\`.
5. Verify with \`deweyou-cli brain status\` and a focused
   \`deweyou-cli brain recall --query '<topic>'\`.
6. Run \`deweyou-cli brain sync\` after the maintenance operations have been
   applied. Resolve non-generated Git conflicts explicitly; do not overwrite
   existing knowledge.

Do not bulk-import or copy historical sessions. Raw agent history remains local.
If older history is useful, inspect only user-selected sessions and capture
small, sourced summaries rather than transcript bodies. Do not include secrets,
credentials, private keys, cookies, or tokens.
`
}

function parseAgent(value: string): BrainAgent {
  if (!BRAIN_AGENTS.includes(value as BrainAgent)) {
    throw new Error(`Brain bootstrap agent must be one of ${BRAIN_AGENTS.join(', ')}`)
  }
  return value as BrainAgent
}

function agentDisplayName(agent: BrainAgent): string {
  const names: Record<BrainAgent, string> = {
    codex: 'Codex',
    claude: 'Claude Code',
    hermes: 'Hermes Agent',
    openclaw: 'OpenClaw',
    trae: 'Trae',
  }
  return names[agent]
}
