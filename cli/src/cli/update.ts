import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type {
  CommandRunner,
  UnifiedUpdateFlags,
  UnifiedUpdateResult,
  UpdateRuntimeOptions,
} from './types.ts'

const execFileAsync = promisify(execFile)

export const defaultRunner: CommandRunner = async (file, args, options = {}) => {
  const result = await execFileAsync(file, args, {
    env: options.env,
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export async function runUnifiedUpdate(
  flags: UnifiedUpdateFlags = {},
  {
    env = process.env,
    logger = console.log,
    platform = process.platform,
    runner = defaultRunner,
  }: UpdateRuntimeOptions = {},
): Promise<UnifiedUpdateResult> {
  const npmBinary = platform === 'win32' ? 'npm.cmd' : 'npm'
  const cliBinary = platform === 'win32' ? 'deweyou-cli.cmd' : 'deweyou-cli'
  const updateCli = !flags.agentsOnly
  const updateAgents = !flags.cliOnly

  if (flags.dryRun) {
    if (updateCli) logger(`Would run: ${npmBinary} install --global deweyou-cli@latest`)
    if (updateAgents) logger(`Would run: ${cliBinary} agent update`)

    return {
      cli: {
        status: updateCli ? 'planned' : 'unchanged',
        version: null,
      },
      agents: {
        status: updateAgents ? 'planned' : 'unchanged',
        source: null,
      },
    }
  }

  if (updateCli) {
    try {
      await runner(npmBinary, ['install', '--global', 'deweyou-cli@latest'], { env })
    } catch (error) {
      throw new Error(`CLI update failed: ${errorMessage(error)}`, { cause: error })
    }
  }

  let version: string
  try {
    const versionResult = await runner(cliBinary, ['--version'], { env })
    version = versionResult.stdout.trim()
  } catch (error) {
    throw new Error(
      `CLI was ${updateCli ? 'updated' : 'left unchanged'}, but its version could not be verified: ${errorMessage(error)}`,
      { cause: error },
    )
  }

  const result: UnifiedUpdateResult = {
    cli: {
      status: updateCli ? 'updated' : 'unchanged',
      version,
    },
    agents: {
      status: updateAgents ? 'updated' : 'unchanged',
      source: null,
    },
  }

  if (updateAgents) {
    try {
      const assetResult = await runner(cliBinary, ['agent', 'update'], { env })
      result.agents.source = parseAssetSource(assetResult.stdout)
    } catch (error) {
      throw new Error(
        `CLI ${version} was ${updateCli ? 'updated' : 'unchanged'}, but agent assets failed to update: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  logger(`CLI: ${result.cli.status}${version ? ` (${version})` : ''}`)
  logger(
    `Agent assets: ${result.agents.status}${
      result.agents.source ? ` (${result.agents.source})` : ''
    }`,
  )

  return result
}

function parseAssetSource(output: string): string | null {
  const match = output.match(/Updated Dewey agent assets from (.+)/)
  return match?.[1]?.trim() ?? null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
