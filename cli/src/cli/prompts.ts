import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  select,
} from '@clack/prompts'
import type {
  AssetRegistry,
  InstallMode,
  InstallScope,
  InstallTool,
  RegistryAsset,
  RuleWiring,
  SelectedAssets,
  ToolSelection,
} from './types.ts'

const SETUP_SCOPES = [
  { value: 'project', label: 'project', hint: 'Install into this repository.' },
  {
    value: 'global',
    label: 'global',
    hint: 'Install into Codex and Claude user homes.',
  },
]

const TOOL_OPTIONS = [
  { value: 'both', label: 'both', hint: 'Wire Codex and Claude Code.' },
  { value: 'codex', label: 'codex', hint: 'Wire AGENTS.md only.' },
  { value: 'claude', label: 'claude', hint: 'Wire CLAUDE.md only.' },
]

const SETUP_MODES = [
  {
    value: 'link',
    label: 'link',
    hint: 'Symlink assets from the Dewey cache.',
  },
  {
    value: 'copy',
    label: 'copy',
    hint: 'Copy asset files into this repository.',
  },
  {
    value: 'pointer',
    label: 'pointer',
    hint: 'Write only the manifest and AGENTS.md pointers.',
  },
]

const RULE_WIRING_OPTIONS = [
  { value: 'reference', label: 'reference', hint: 'Reference selected rule files.' },
  { value: 'inline', label: 'inline', hint: 'Inline selected rule bodies.' },
]

const ASSET_SCOPES = [
  {
    value: 'all',
    label: 'all',
    hint: 'Enable every cached skill and rule.',
  },
  {
    value: 'custom',
    label: 'custom',
    hint: 'Choose skills and rules individually.',
  },
  {
    value: 'skills',
    label: 'skills only',
    hint: 'Choose skills without installing rules.',
  },
  {
    value: 'rules',
    label: 'rules only',
    hint: 'Choose rules without installing skills.',
  },
  {
    value: 'design',
    label: 'design only',
    hint: 'Install a design contract as DESIGN.md.',
  },
]

const GLOBAL_ASSET_SCOPES = [
  {
    value: 'all',
    label: 'all',
    hint: 'Enable every cached skill and rule.',
  },
  {
    value: 'custom',
    label: 'custom',
    hint: 'Choose skills and rules individually.',
  },
  {
    value: 'skills',
    label: 'skills only',
    hint: 'Choose skills without installing rules.',
  },
  {
    value: 'rules',
    label: 'rules only',
    hint: 'Choose rules without installing skills.',
  },
]

export async function promptForInit({
  registry,
  repoRoot,
  mode,
  scope,
  tools,
  ruleWiring,
}: {
  registry: AssetRegistry
  repoRoot: string
  mode?: InstallMode
  scope?: InstallScope
  tools?: ToolSelection
  ruleWiring?: RuleWiring
}): Promise<{
  mode: InstallMode
  scope: InstallScope
  tools: InstallTool[]
  ruleWiring: RuleWiring
  selected: SelectedAssets
}> {
  intro('Dewey Agent Setup')
  note(repoRoot, 'Repository')

  const selectedScope =
    scope ??
    (await promptOrExit<InstallScope>(
      select({
        message: 'Select install scope',
        options: SETUP_SCOPES,
      }) as Promise<InstallScope>,
    ))
  const selectedTools =
    tools === undefined
      ? normalizePromptTools(
          await promptOrExit<'both' | 'codex' | 'claude'>(
            select({
              message: 'Select tools',
              options: TOOL_OPTIONS,
            }) as Promise<'both' | 'codex' | 'claude'>,
          ),
        )
      : normalizeToolSelection(tools)
  const selectedMode =
    selectedScope === 'global'
      ? 'pointer'
      : mode ??
        (await promptOrExit<InstallMode>(
          select({
            message: 'Select setup mode',
            options: SETUP_MODES,
          }) as Promise<InstallMode>,
        ))
  const assetScope = await promptOrExit<'all' | 'custom' | 'skills' | 'rules' | 'design'>(
    select({
      message: 'Select asset scope',
      options: selectedScope === 'global' ? GLOBAL_ASSET_SCOPES : ASSET_SCOPES,
    }) as Promise<'all' | 'custom' | 'skills' | 'rules' | 'design'>,
  )

  const selected = await selectAssets({
    registry,
    scope: assetScope,
    installScope: selectedScope,
  })
  const selectedRuleWiring =
    ruleWiring ??
    (selected.rules.length > 0
      ? await promptOrExit<RuleWiring>(
          select({
            message: 'Select rule wiring',
            options: RULE_WIRING_OPTIONS,
          }) as Promise<RuleWiring>,
        )
      : 'reference')
  note(
    plannedFiles({
      repoRoot,
      scope: selectedScope,
      tools: selectedTools,
      selected,
    }),
    'Dewey will update',
  )
  const accepted = await promptOrExit(
    confirm({
      message: `Enable ${selected.skills.length} skill(s), ${selected.rules.length} rule(s), and ${selected.design ? 1 : 0} design contract(s) using ${selectedMode} mode?`,
    }),
  )

  if (!accepted) {
    exitCancelled()
  }

  return {
    mode: selectedMode,
    scope: selectedScope,
    tools: selectedTools,
    ruleWiring: selectedRuleWiring,
    selected,
  }
}

async function selectAssets({
  registry,
  scope,
  installScope,
}: {
  registry: AssetRegistry
  scope: 'all' | 'custom' | 'skills' | 'rules' | 'design'
  installScope: InstallScope
}): Promise<SelectedAssets> {
  if (scope === 'all') {
    return {
      skills: Object.keys(registry.assets.skills),
      rules: Object.keys(registry.assets.rules),
    }
  }

  const selected: SelectedAssets = {
    skills: [],
    rules: [],
  }

  if (scope === 'custom' || scope === 'skills') {
    selected.skills = await promptOrExit<string[]>(
      multiselect({
        message: 'Select skills',
        options: assetOptions(registry.assets.skills),
        required: false,
      }) as Promise<string[]>,
    )
  }

  if (scope === 'custom' || scope === 'rules') {
    selected.rules = await promptOrExit<string[]>(
      multiselect({
        message: 'Select rules',
        options: assetOptions(registry.assets.rules),
        required: false,
      }) as Promise<string[]>,
    )
  }

  if (
    installScope === 'project' &&
    (scope === 'custom' || scope === 'design') &&
    Object.keys(registry.assets.designs ?? {}).length > 0
  ) {
    const designOptions = [
      { value: '', label: 'none', hint: 'Do not install DESIGN.md.' },
      ...assetOptions(registry.assets.designs ?? {}),
    ]
    const design = await promptOrExit<string>(
      select({
        message: 'Select design contract',
        options: designOptions,
      }) as Promise<string>,
    )
    if (design) selected.design = design
  }

  return selected
}

function assetOptions(assets: Record<string, RegistryAsset>) {
  return Object.entries(assets).map(([name, asset]) => ({
    value: name,
    label: name,
    hint: asset.description,
  }))
}

function normalizePromptTools(selectedTools: 'both' | 'codex' | 'claude'): InstallTool[] {
  if (selectedTools === 'both') return ['codex', 'claude']
  return [selectedTools]
}

function normalizeToolSelection(tools: ToolSelection): InstallTool[] {
  if (tools.includes('all')) return ['codex', 'claude']
  return [...new Set(tools)] as InstallTool[]
}

function plannedFiles({
  repoRoot,
  scope,
  tools,
  selected,
}: {
  repoRoot: string
  scope: InstallScope
  tools: InstallTool[]
  selected: SelectedAssets
}): string {
  const files: string[] = []
  if (scope === 'global') {
    if (selected.rules.length > 0 && tools.includes('codex')) {
      files.push('~/.codex/AGENTS.md')
    }
    if (selected.rules.length > 0 && tools.includes('claude')) {
      files.push('~/.claude/CLAUDE.md')
    }
    if (selected.skills.length > 0 && tools.includes('codex')) {
      files.push('~/.agents/skills/<skill>')
    }
    if (selected.skills.length > 0 && tools.includes('claude')) {
      files.push('~/.claude/skills/<skill>')
    }
    files.push('~/.deweyou/agents/global-manifest.json')
    return files.join('\n')
  }

  files.push('AGENTS.md')
  if (tools.includes('claude') && selected.rules.length > 0) {
    files.push('CLAUDE.md')
  }
  files.push('.agents/manifest.json')
  if (selected.skills.length > 0) files.push('.agents/skills/<skill>/SKILL.md')
  if (selected.rules.length > 0) files.push('.agents/rules/<rule>.md')
  if (selected.design) files.push('DESIGN.md')
  return `${repoRoot}\n\n${files.join('\n')}`
}

async function promptOrExit<T>(prompt: Promise<T>): Promise<T> {
  const value = await prompt
  if (isCancel(value)) {
    exitCancelled()
  }
  return value
}

function exitCancelled() {
  cancel('Dewey agent setup cancelled.')
  process.exit(0)
}
