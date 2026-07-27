import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  text,
} from '@clack/prompts'
import { join } from 'node:path'

import { usageError } from './args.ts'
import type {
  BrainInitPromptInput,
  BrainInitPromptResult,
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

  note(
    [
      `Repository: ${repo}`,
      `Device: ${device}`,
      `Remote: ${remote ?? 'none'}`,
      `Branch: ${branch}`,
      'Existing repository content will be preserved.',
      'The remote branch will be fast-forwarded before Deweyou files are added.',
      'History, hooks, and background workers are not changed by init.',
      'Agent-specific bootstrap prompt commands are printed after attachment.',
    ].join('\n'),
    'Deweyou will attach',
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
  }
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
