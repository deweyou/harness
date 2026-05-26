import { spawn } from 'node:child_process'

import type { InstallMode, InstallScope, InstallTool } from './types.ts'

const SKILLS_PACKAGE = 'skills@latest'
export const DEFAULT_SKILLS_SOURCE = 'deweyou/agents'

export interface SkillsAddOptions {
  cwd: string
  source: string
  skills: string[]
  tools: InstallTool[]
  scope: InstallScope
  mode: Extract<InstallMode, 'link' | 'copy'>
}

export interface SkillsCommand {
  command: string
  args: string[]
}

export type SkillsInstaller = (options: SkillsAddOptions) => Promise<void>

export function buildSkillsAddCommand(options: SkillsAddOptions): SkillsCommand {
  return {
    command: 'npx',
    args: [
      '-y',
      SKILLS_PACKAGE,
      'add',
      options.source,
      '--skill',
      ...options.skills,
      '--agent',
      ...options.tools.map(skillsAgentName),
      '--yes',
      ...(options.scope === 'global' ? ['-g'] : []),
      ...(options.mode === 'copy' ? ['--copy'] : []),
    ],
  }
}

export async function runSkillsInstall(options: SkillsAddOptions): Promise<void> {
  const { command, args } = buildSkillsAddCommand(options)
  await runCommand(command, args, options.cwd)
}

function skillsAgentName(tool: InstallTool): string {
  if (tool === 'claude') return 'claude-code'
  return tool
}

/* v8 ignore start -- unit tests cover command construction; spawn is the boundary. */
async function runCommand(
  command: string,
  args: string[],
  cwd: string | undefined,
): Promise<void> {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', resolve)
  })

  if (exitCode && exitCode !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed with exit code ${exitCode}`)
    ;(error as Error & { exitCode: number }).exitCode = exitCode
    throw error
  }
}
/* v8 ignore stop */
