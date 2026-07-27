import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  text,
} from '@clack/prompts'
import { join } from 'node:path'

import { usageError } from './args.ts'
import type {
  BrainInitPromptInput,
  BrainInitPromptResult,
  DiscoverableBrainAgent,
} from './brain-types.ts'

export async function promptForBrainInit(
  input: BrainInitPromptInput,
): Promise<BrainInitPromptResult> {
  intro('Deweyou Brain Setup')
  const repo = expandHome(
    await promptOrCancel<string>(
      text({
        message: 'Knowledge repository path',
        initialValue: input.defaultRepo,
        validate: requiredValue('Knowledge repository path'),
      }) as Promise<string>,
    ),
    input.homeDir,
  )
  const device = await promptOrCancel<string>(
    text({
      message: 'Device id',
      initialValue: input.defaultDevice,
      validate(value) {
        return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
          ? undefined
          : 'Use a lowercase filesystem-safe id.'
      },
    }) as Promise<string>,
  )
  const remote = (
    await promptOrCancel<string>(
      text({
        message: 'Private Git remote (optional)',
        placeholder: 'git@github.com:owner/personal-brain.git',
      }) as Promise<string>,
    )
  ).trim() || undefined
  const branch = await promptOrCancel<string>(
    text({
      message: 'Git branch',
      initialValue: 'main',
      validate: requiredValue('Git branch'),
    }) as Promise<string>,
  )

  const options = importOptions(input)
  const importAgents =
    options.length === 0
      ? []
      : await promptOrCancel<DiscoverableBrainAgent[]>(
          multiselect({
            message: 'Import discovered local history now',
            options,
            initialValues: [],
            required: false,
          }) as Promise<DiscoverableBrainAgent[]>,
        )
  const hookAgents = await promptOrCancel<
    Array<'codex' | 'claude' | 'hermes' | 'openclaw'>
  >(
    multiselect({
      message: 'Install global agent hooks',
      options: [
        {
          value: 'codex',
          label: 'codex',
          hint: 'Capture and inject context through Codex hooks.',
        },
        {
          value: 'claude',
          label: 'claude',
          hint: 'Capture and inject context through Claude Code hooks.',
        },
        {
          value: 'hermes',
          label: 'hermes',
          hint: 'Install the Hermes shell hook adapter.',
        },
        {
          value: 'openclaw',
          label: 'openclaw',
          hint: 'Install the linked OpenClaw plugin.',
        },
      ],
      initialValues: [],
      required: false,
    }) as Promise<Array<'codex' | 'claude' | 'hermes' | 'openclaw'>>,
  )
  const installSchedule =
    input.supportsSchedule &&
    await promptOrCancel<boolean>(
      confirm({
        message: 'Install the macOS background maintenance worker?',
        initialValue: false,
      }) as Promise<boolean>,
    )
  note(
    [
      `Repository: ${repo}`,
      `Device: ${device}`,
      `Remote: ${remote ?? 'none'}`,
      `Branch: ${branch}`,
      `History: ${importAgents.length === 0 ? 'not imported' : importAgents.join(', ')}`,
      `Hooks: ${hookAgents.length === 0 ? 'not installed' : hookAgents.join(', ')}`,
      `Background worker: ${installSchedule ? 'install' : 'not installed'}`,
      ...(input.discovery.warnings.length === 0
        ? []
        : [`Discovery warnings: ${input.discovery.warnings.join(' | ')}`]),
      'Discovered history uses private classification and device scope.',
      'Install Trae separately with `brain hook install --agent trae --repo <path>`.',
    ].join('\n'),
    'Deweyou will initialize',
  )
  const accepted = await promptOrCancel<boolean>(
    confirm({
      message: 'Initialize this personal Context Hub?',
      initialValue: true,
    }) as Promise<boolean>,
  )
  if (!accepted) {
    cancel('Deweyou Brain setup cancelled.')
    throw usageError('Deweyou Brain setup cancelled.', { silent: true })
  }
  return {
    repo,
    device,
    remote,
    branch,
    importAgents,
    hookAgents,
    installSchedule,
  }
}

function importOptions(input: BrainInitPromptInput) {
  const labels: Array<{
    value: DiscoverableBrainAgent
    label: string
    hint: string
  }> = []
  for (const agent of input.discovery.agents) {
    const sources = input.discovery.sources.filter(
      (source) => source.agent === agent,
    )
    const records = sources.reduce((total, source) => total + source.records, 0)
    if (records === 0) continue
    const bytes = sources.reduce(
      (total, source) => total + source.source_bytes,
      0,
    )
    labels.push({
      value: agent,
      label: agent,
      hint: `${records} session(s), ${formatBytes(bytes)} source data`,
    })
  }
  return labels
}

function requiredValue(label: string) {
  return (value: string) => value.trim() ? undefined : `${label} is required.`
}

async function promptOrCancel<T>(prompt: Promise<T>): Promise<T> {
  const value = await prompt
  if (isCancel(value)) {
    cancel('Deweyou Brain setup cancelled.')
    throw usageError('Deweyou Brain setup cancelled.', { silent: true })
  }
  return value
}

function expandHome(value: string, homeDir: string): string {
  const trimmed = value.trim()
  if (trimmed === '~') return homeDir
  if (trimmed.startsWith('~/')) return join(homeDir, trimmed.slice(2))
  return trimmed
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let amount = value / 1024
  for (const unit of units) {
    if (amount < 1024 || unit === units.at(-1)) {
      return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`
    }
    amount /= 1024
  }
  return `${value} B`
}
