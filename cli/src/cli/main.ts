import {
  parseArgs,
  parseBrainHookArgs,
  parseBrainScheduleArgs,
  parseDevSessionArgs,
  parseUpdateArgs,
  usageError,
} from './args.ts'
import type { DevFlags } from './types.ts'
import { CLI_VERSION } from './version-contract.ts'

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
const BRAIN_COMMANDS = [
  'init',
  'bootstrap',
  'status',
  'capture',
  'import',
  'index',
  'recall',
  'export',
  'state',
  'maintain',
  'apply',
  'sync',
  'worker',
] as const
type AgentCommand = (typeof AGENT_COMMANDS)[number]
type DevCommand = (typeof DEV_COMMANDS)[number]
type BrainCommand = (typeof BRAIN_COMMANDS)[number]

export async function main(argv: string[]): Promise<void> {
  const help = helpFor(argv)
  if (help) {
    console.log(help)
    return
  }

  if (isVersionRequest(argv)) {
    console.log(CLI_VERSION)
    return
  }

  if (argv[0] === 'update') {
    const { runUnifiedUpdate } = await import('./update.ts')
    await runUnifiedUpdate(parseUpdateArgs(argv.slice(1)))
    return
  }

  if (argv[0] === 'dev' && argv[1] === 'session') {
    await runDevSessionCommand(argv.slice(2))
    return
  }
  if (argv[0] === 'brain' && argv[1] === 'hook') {
    const parsed = parseBrainHookArgs(argv.slice(2))
    const brain = await import('./brain-cli.ts')
    await brain.runBrainHookCommand(parsed.command, parsed.flags)
    return
  }
  if (argv[0] === 'brain' && argv[1] === 'schedule') {
    const parsed = parseBrainScheduleArgs(argv.slice(2))
    const brain = await import('./brain-cli.ts')
    await brain.runBrainScheduleCommand(parsed.command, parsed.flags)
    return
  }

  const parsed = parseArgs(argv)

  if (
    parsed.topic !== 'agent' &&
    parsed.topic !== 'dev' &&
    parsed.topic !== 'brain'
  ) {
    printUsageAndThrow()
  }

  if (parsed.topic === 'brain') {
    const brain = await import('./brain-cli.ts')
    if (parsed.command === 'init') await brain.runBrainInit(parsed.flags)
    else if (parsed.command === 'bootstrap') await brain.runBrainBootstrap(parsed.flags)
    else if (parsed.command === 'status') await brain.runBrainStatus(parsed.flags)
    else if (parsed.command === 'capture') await brain.runBrainCapture(parsed.flags)
    else if (parsed.command === 'import') await brain.runBrainImport(parsed.flags)
    else if (parsed.command === 'index') await brain.runBrainIndex(parsed.flags)
    else if (parsed.command === 'recall') await brain.runBrainRecall(parsed.flags)
    else if (parsed.command === 'export') await brain.runBrainExport(parsed.flags)
    else if (parsed.command === 'state') await brain.runBrainState(parsed.flags)
    else if (parsed.command === 'maintain') await brain.runBrainMaintain(parsed.flags)
    else if (parsed.command === 'apply') await brain.runBrainApply(parsed.flags)
    else if (parsed.command === 'sync') await brain.runBrainSync(parsed.flags)
    else if (parsed.command === 'worker') await brain.runBrainWorker(parsed.flags)
    else printUsageAndThrow()
    return
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
  deweyou-cli update [--dry-run] [--cli-only|--agents-only]
  deweyou-cli agent <command> [options]
  deweyou-cli dev <command> [options]
  deweyou-cli brain <command> [options]

Commands:
  update          Update the global CLI and refresh Dewey agent assets.
  agent init      Initialize the current repository with Dewey assets.
  agent update    Refresh the local Dewey asset cache.
  agent context   Print the active Dewey agent context.
  agent doctor    Check whether the repository and cache are healthy.
  dev install     Initialize manual DDev runtime and global per-repo state.
  dev session     Manage explicit task-based DDev sessions.
  dev status      Print DDev runtime and repository status.
  dev doctor      Diagnose local DDev runtime and repo state.
  dev clean       Remove DDev-owned global per-repo state.
  dev demo        Create and serve the active task-session HTML demo workspace.
  dev record      Append a validated protocol event to a task session.
  dev summary     Summarize task-session events and update summary.md.
  dev uninstall   Remove repo state, legacy state, old hooks, and unused runtime.
  brain init      Bind a separate personal knowledge repository.
  brain bootstrap Print a model-driven setup prompt for one agent.
  brain capture   Capture one normalized agent lifecycle event.
  brain import    Import historical agent session files.
  brain recall    Build a scoped, token-budgeted Context Pack.
  brain export    Create a classification-filtered projection.
  brain state     Record an auditable soft lifecycle decision.
  brain maintain  Print an agent-driven maintenance prompt.
  brain apply     Validate and apply one agent proposal.
  brain sync      Reconcile and synchronize the Git knowledge ledger.
  brain hook      Install, inspect, run, or remove agent adapters.
  brain schedule  Install, inspect, or remove the local worker schedule.

Options:
  -h, --help      Show help.
  -v, --version   Show the CLI version.`
}

function updateUsage(): string {
  return `Usage:
  deweyou-cli update [--dry-run] [--cli-only|--agents-only]

Options:
  --dry-run       Print update commands without executing them.
  --cli-only      Update only the globally installed CLI.
  --agents-only   Refresh only the Dewey agent assets.
  -h, --help      Show help.`
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
  deweyou-cli dev session start --title "task"
  deweyou-cli dev session list|status|close|archive|clean
  deweyou-cli dev status
  deweyou-cli dev doctor
  deweyou-cli dev clean [--branch name|--all] [--dry-run] --force
  deweyou-cli dev demo [--id id|--branch name] [--host host] [--port port] [--no-server] [--dry-run]
  deweyou-cli dev record [--id id|--branch name] --kind kind (--data json|--data-file path)
  deweyou-cli dev summary [--id id|--branch name] [--format markdown|json]
  deweyou-cli dev uninstall [--dry-run]

Run \`deweyou-cli dev <command> -h\` for command-specific help.`
}

function brainUsage(): string {
  return `Usage:
  deweyou-cli brain init [--repo <path>] [--device id] [--remote url]
  deweyou-cli brain bootstrap --agent agent
  deweyou-cli brain status
  deweyou-cli brain capture --agent agent --event event [--data json|--data-file path]
  deweyou-cli brain import --discover [--agent codex|hermes|all] [--dry-run]
  deweyou-cli brain import --agent agent --path file-or-directory
  deweyou-cli brain index
  deweyou-cli brain recall --query text [--scope a,b] [--clearance level] [--budget tokens]
  deweyou-cli brain export --output path [--clearance level] [--scope a,b]
  deweyou-cli brain state --id artifact-id --status state --reason text
  deweyou-cli brain maintain [--agent agent] [--session id]
  deweyou-cli brain apply (--data json|--data-file path)
  deweyou-cli brain sync
  deweyou-cli brain worker [--no-push]
  deweyou-cli brain hook install|status|uninstall --agent agent|all [--repo path]
  deweyou-cli brain schedule install|status|uninstall [--interval seconds]

Run \`deweyou-cli brain <command> -h\` for command-specific help.`
}

function brainHookUsage(command?: string): string {
  if (command === 'run') {
    return 'Usage:\n  deweyou-cli brain hook run --agent agent --event event'
  }
  return `Usage:
  deweyou-cli brain hook install --agent agent|all [--repo path] [--dry-run]
  deweyou-cli brain hook status [--agent agent|all] [--repo path]
  deweyou-cli brain hook uninstall --agent agent|all [--repo path] [--dry-run]`
}

function brainScheduleUsage(command?: string): string {
  if (command === 'install') {
    return 'Usage:\n  deweyou-cli brain schedule install [--interval 300] [--dry-run]'
  }
  if (command === 'status') return 'Usage:\n  deweyou-cli brain schedule status'
  if (command === 'uninstall') {
    return 'Usage:\n  deweyou-cli brain schedule uninstall [--dry-run]'
  }
  return `Usage:
  deweyou-cli brain schedule install [--interval 300] [--dry-run]
  deweyou-cli brain schedule status
  deweyou-cli brain schedule uninstall [--dry-run]`
}

function brainCommandUsage(command: BrainCommand): string {
  if (command === 'init') {
    return `Usage:
  deweyou-cli brain init
  deweyou-cli brain init --repo <path> [--device id] [--remote url] [--branch name] [--dry-run]`
  }
  if (command === 'bootstrap') {
    return `Usage:
  deweyou-cli brain bootstrap --agent codex|claude|hermes|openclaw|trae`
  }
  if (command === 'capture') {
    return `Usage:
  deweyou-cli brain capture --agent agent --event event [--session id] [--cwd path] [--scope a,b] [--classification level] [--data json|--data-file path]`
  }
  if (command === 'import') {
    return `Usage:
  deweyou-cli brain import --discover [--agent codex|hermes|all] [--scope a,b] [--classification level] [--dry-run]
  deweyou-cli brain import --agent agent --path file-or-directory [--scope a,b] [--classification level]`
  }
  if (command === 'recall') {
    return `Usage:
  deweyou-cli brain recall --query text [--scope a,b] [--clearance public|private|confidential|restricted] [--budget tokens] [--format markdown|json] [--include-archived]`
  }
  if (command === 'export') {
    return `Usage:
  deweyou-cli brain export --output path [--clearance public|private|confidential|restricted] [--scope a,b] [--format wiki|knowledge] [--dry-run]`
  }
  if (command === 'state') {
    return `Usage:
  deweyou-cli brain state --id artifact-id --status active|stale|archived|deleted --reason text`
  }
  if (command === 'maintain') {
    return `Usage:
  deweyou-cli brain maintain [--agent codex|claude|hermes|openclaw|trae] [--session id]`
  }
  if (command === 'apply') {
    return `Usage:
  deweyou-cli brain apply (--data json|--data-file path)`
  }
  return `Usage:
  deweyou-cli brain ${command}`
}

function devSessionUsage(command?: string): string {
  if (command === 'start') return 'Usage:\n  deweyou-cli dev session start --title "task title"'
  if (command === 'list') return 'Usage:\n  deweyou-cli dev session list'
  if (command === 'status') return 'Usage:\n  deweyou-cli dev session status [--id session-id]'
  if (command === 'close') return 'Usage:\n  deweyou-cli dev session close [--id session-id]'
  if (command === 'archive') return 'Usage:\n  deweyou-cli dev session archive [--id session-id]'
  if (command === 'clean') {
    return 'Usage:\n  deweyou-cli dev session clean [--id session-id|--all] [--dry-run] --force'
  }
  return `Usage:
  deweyou-cli dev session start --title "task title"
  deweyou-cli dev session list
  deweyou-cli dev session status [--id session-id]
  deweyou-cli dev session close [--id session-id]
  deweyou-cli dev session archive [--id session-id]
  deweyou-cli dev session clean [--id session-id|--all] [--dry-run] --force`
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
  deweyou-cli dev clean [--branch name|--all] [--dry-run] --force

Options:
  --branch name  Clean one branch session.
  --all          Clean all DDev state for the current repository.
  --dry-run      Print the target without removing files.
  --force        Confirm permanent deletion.
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
  deweyou-cli dev demo [--id id|--branch name] [--host host] [--port port] [--no-server] [--dry-run]

Options:
  --id id        Use a managed task session by id.
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
  deweyou-cli dev record [--id id|--branch name] --kind requirement|node|evidence|failure|review|recovery|delivery (--data json|--data-file path)

Options:
  --branch name  Use a specific branch session.
  --kind kind    Select the validated DDev event payload contract.
  --data json    Provide the event payload as one JSON object.
  --data-file path
                 Read the event payload from a JSON file. Stdin is used when neither flag is present.
  -h, --help     Show help.`
  }

  if (command === 'summary') {
    return `Usage:
  deweyou-cli dev summary [--id id|--branch name] [--format markdown|json]

Options:
  --id id                 Use a managed task session by id.
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
  if (argv[0] === 'update') return updateUsage()
  if (argv[0] === 'dev' && argv[1] === 'session') return devSessionUsage(argv[2])
  if (argv[0] === 'brain' && argv[1] === 'hook') return brainHookUsage(argv[2])
  if (argv[0] === 'brain' && argv[1] === 'schedule') {
    return brainScheduleUsage(argv[2])
  }
  if (argv[0] !== 'agent' && argv[0] !== 'dev' && argv[0] !== 'brain') return rootUsage()

  const command = argv[1]
  if (argv[0] === 'brain') {
    if (!command || isHelpFlag(command)) return brainUsage()
    if (isBrainCommand(command)) return brainCommandUsage(command)
    return brainUsage()
  }
  if (argv[0] === 'dev') {
    if (!command || isHelpFlag(command)) return devUsage()
    if (isDevCommand(command)) return devCommandUsage(command)
    return devUsage()
  }

  if (!command || isHelpFlag(command)) return agentUsage()
  if (isAgentCommand(command)) return commandUsage(command)
  return agentUsage()
}

async function runDevSessionCommand(argv: string[]): Promise<void> {
  const parsed = parseDevSessionArgs(argv)
  const session = await import('./dev-session.ts')
  if (parsed.command === 'start') await session.runDevSessionStart(parsed.flags)
  if (parsed.command === 'list') await session.runDevSessionList(parsed.flags)
  if (parsed.command === 'status') await session.runDevSessionStatus(parsed.flags)
  if (parsed.command === 'close') await session.runDevSessionClose(parsed.flags)
  if (parsed.command === 'archive') await session.runDevSessionArchive(parsed.flags)
  if (parsed.command === 'clean') await session.runDevSessionClean(parsed.flags)
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

function isBrainCommand(value: string): value is BrainCommand {
  return BRAIN_COMMANDS.includes(value as BrainCommand)
}
