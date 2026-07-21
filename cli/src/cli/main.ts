import { parseArgs, usageError } from './args.ts'
import type { DevFlags } from './types.ts'
import packageJson from '../../package.json' with { type: 'json' }

const AGENT_COMMANDS = ['init', 'update', 'context', 'doctor'] as const
const DEV_COMMANDS = [
  'install',
  'status',
  'doctor',
  'clean',
  'demo',
  'record',
  'summary',
  'uninstall',
] as const
type AgentCommand = (typeof AGENT_COMMANDS)[number]
type DevCommand = (typeof DEV_COMMANDS)[number]

export async function main(argv: string[]): Promise<void> {
  const help = helpFor(argv)
  if (help) {
    console.log(help)
    return
  }

  if (isVersionRequest(argv)) {
    console.log(packageJson.version)
    return
  }

  const parsed = parseArgs(argv)

  if (parsed.topic !== 'agent' && parsed.topic !== 'dev') {
    printUsageAndThrow()
  }

  if (parsed.topic === 'dev') {
    if (parsed.command === 'install') {
      const { runDevInstall } = await import('./dev.ts')
      await runDevInstall(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'status') {
      const { runDevStatus } = await import('./dev.ts')
      await runDevStatus(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'doctor') {
      const { runDevDoctor } = await import('./dev.ts')
      await runDevDoctor(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'clean') {
      const { runDevClean } = await import('./dev.ts')
      await runDevClean(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'uninstall') {
      const { runDevUninstall } = await import('./dev.ts')
      await runDevUninstall(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'demo') {
      const { runDevDemo } = await import('./dev.ts')
      await runDevDemo(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'record') {
      const { runDevRecord } = await import('./dev.ts')
      await runDevRecord(parsed.flags as DevFlags)
      return
    }

    if (parsed.command === 'summary') {
      const { runDevSummary } = await import('./dev.ts')
      await runDevSummary(parsed.flags as DevFlags)
      return
    }

    printUsageAndThrow()
  }

  if (parsed.command === 'init') {
    const { runInit } = await import('./init.ts')
    await runInit(parsed.flags)
    return
  }

  if (parsed.command === 'update') {
    const { runUpdate } = await import('./cache.ts')
    await runUpdate(parsed.flags)
    return
  }

  if (parsed.command === 'context') {
    const { runContext } = await import('./context.ts')
    await runContext(parsed.flags)
    return
  }

  if (parsed.command === 'doctor') {
    const { runDoctor } = await import('./doctor.ts')
    await runDoctor(parsed.flags)
    return
  }

  printUsageAndThrow()
}

function usage(): string {
  return rootUsage()
}

function rootUsage(): string {
  return `Usage:
  deweyou-cli agent <command> [options]
  deweyou-cli dev <command> [options]

Commands:
  agent init      Initialize the current repository with Dewey assets.
  agent update    Refresh the local Dewey asset cache.
  agent context   Print the active Dewey agent context.
  agent doctor    Check whether the repository and cache are healthy.
  dev install     Initialize manual DDev runtime and global per-repo state.
  dev status      Print DDev runtime and branch-session status.
  dev doctor      Diagnose local DDev runtime and repo state.
  dev clean       Remove DDev-owned global per-repo state.
  dev demo        Create and serve the branch-session HTML demo workspace.
  dev record      Append a validated protocol event to the branch session.
  dev summary     Summarize branch-session events and update summary.md.
  dev uninstall   Remove repo state, legacy state, old hooks, and unused runtime.

Options:
  -h, --help      Show help.
  -v, --version   Show the CLI version.`
}

function agentUsage(): string {
  return `Usage:
  deweyou-cli agent init [--all] [--skills a,b] [--rules a,b] [--design name] [--mode link|copy|pointer] [--global|--scope project|global] [--tools codex,claude|all] [--rule-wiring reference|inline] [--yes] [--dry-run] [--force]
  deweyou-cli agent update
  deweyou-cli agent context [--format markdown|json]
  deweyou-cli agent doctor

Run \`deweyou-cli agent <command> -h\` for command-specific help.`
}

function devUsage(): string {
  return `Usage:
  deweyou-cli dev install [--dry-run]
  deweyou-cli dev status
  deweyou-cli dev doctor
  deweyou-cli dev clean [--branch name|--all] [--dry-run]
  deweyou-cli dev demo [--branch name] [--host host] [--port port] [--no-server] [--dry-run]
  deweyou-cli dev record [--branch name] --kind kind --data json
  deweyou-cli dev summary [--branch name] [--format markdown|json]
  deweyou-cli dev uninstall [--dry-run]

Run \`deweyou-cli dev <command> -h\` for command-specific help.`
}

function commandUsage(command: AgentCommand): string {
  if (command === 'init') {
    return `Usage:
  deweyou-cli agent init [--all] [--skills a,b] [--rules a,b] [--design name] [--mode link|copy|pointer] [--global|--scope project|global] [--tools codex,claude|all] [--rule-wiring reference|inline] [--yes] [--dry-run] [--force]

Options:
  --all                         Select every skill and rule.
  --skills a,b                  Select comma-separated skill ids.
  --rules a,b                   Select comma-separated rule ids.
  --design name                 Install a design contract as DESIGN.md.
  --mode link|copy|pointer      Choose how assets are referenced.
  --global                      Install selected skills and rules globally.
  --scope project|global        Write project or user-level instructions.
  --tools codex,claude|all      Select target agent tools.
  --rule-wiring reference|inline
                                Choose how rules are written into instructions.
  --yes                         Run without prompts for scripted selections.
  --dry-run                     Print the plan without writing files.
  --force                       Replace existing Dewey-managed destinations.
  -h, --help                    Show help.`
  }

  if (command === 'context') {
    return `Usage:
  deweyou-cli agent context [--format markdown|json]

Options:
  --format markdown|json   Choose human-readable or structured output.
  -h, --help               Show help.`
  }

  if (command === 'update') {
    return `Usage:
  deweyou-cli agent update

Options:
  -h, --help   Show help.`
  }

  return `Usage:
  deweyou-cli agent doctor

Options:
  -h, --help   Show help.`
}

function devCommandUsage(command: DevCommand): string {
  if (command === 'install') {
    return `Usage:
  deweyou-cli dev install [--dry-run]

Options:
  --dry-run   Print planned DDev writes without changing files.
  -h, --help  Show help.`
  }

  if (command === 'clean') {
    return `Usage:
  deweyou-cli dev clean [--branch name|--all] [--dry-run]

Options:
  --branch name  Clean one branch session.
  --all          Clean all DDev state for the current repository.
  --dry-run      Print the target without removing files.
  -h, --help     Show help.`
  }

  if (command === 'status') {
    return `Usage:
  deweyou-cli dev status

Options:
  -h, --help   Show help.`
  }

  if (command === 'demo') {
    return `Usage:
  deweyou-cli dev demo [--branch name] [--host host] [--port port] [--no-server] [--dry-run]

Options:
  --branch name  Use a specific branch session.
  --host host    Host to bind. Defaults to 127.0.0.1.
  --port port    Port to bind. Defaults to 4173. Use 0 for any free port.
  --no-server    Create the demo files without starting a server.
  --dry-run      Print the demo target without changing files.
  -h, --help     Show help.`
  }

  if (command === 'uninstall') {
    return `Usage:
  deweyou-cli dev uninstall [--dry-run]

Options:
  --dry-run   Print planned removals without changing files.
  -h, --help  Show help.`
  }

  if (command === 'record') {
    return `Usage:
  deweyou-cli dev record [--branch name] --kind requirement|node|evidence|failure|review|recovery|delivery --data json

Options:
  --branch name  Use a specific branch session.
  --kind kind    Select the validated DDev event payload contract.
  --data json    Provide the event payload as one JSON object.
  -h, --help     Show help.`
  }

  if (command === 'summary') {
    return `Usage:
  deweyou-cli dev summary [--branch name] [--format markdown|json]

Options:
  --branch name          Use a specific branch session.
  --format markdown|json Choose console output. summary.md is always updated.
  -h, --help             Show help.`
  }

  return `Usage:
  deweyou-cli dev doctor

Options:
  -h, --help   Show help.`
}

function printUsageAndThrow(): never {
  console.log(usage())
  throw usageError('', { silent: true })
}

function helpFor(argv: string[]): string | null {
  if (!argv.some(isHelpFlag)) return null
  if (isHelpFlag(argv[0])) return rootUsage()
  if (argv[0] !== 'agent' && argv[0] !== 'dev') return rootUsage()

  const command = argv[1]
  if (argv[0] === 'dev') {
    if (!command || isHelpFlag(command)) return devUsage()
    if (isDevCommand(command)) return devCommandUsage(command)
    return devUsage()
  }

  if (!command || isHelpFlag(command)) return agentUsage()
  if (isAgentCommand(command)) return commandUsage(command)
  return agentUsage()
}

function isVersionRequest(argv: string[]): boolean {
  return argv.length === 1 && (argv[0] === '-v' || argv[0] === '--version')
}

function isHelpFlag(value: string | undefined): boolean {
  return value === '-h' || value === '--help'
}

function isAgentCommand(value: string): value is AgentCommand {
  return AGENT_COMMANDS.includes(value as AgentCommand)
}

function isDevCommand(value: string): value is DevCommand {
  return DEV_COMMANDS.includes(value as DevCommand)
}
