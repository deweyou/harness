import { parseArgs, usageError } from './args.ts'
import packageJson from '../../package.json' with { type: 'json' }

const COMMANDS = ['init', 'update', 'context', 'doctor'] as const
type AgentCommand = (typeof COMMANDS)[number]

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

  if (parsed.topic !== 'agent') {
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

Commands:
  agent init      Initialize the current repository with Dewey assets.
  agent update    Refresh the local Dewey asset cache.
  agent context   Print the active Dewey agent context.
  agent doctor    Check whether the repository and cache are healthy.

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

function printUsageAndThrow(): never {
  console.log(usage())
  throw usageError('', { silent: true })
}

function helpFor(argv: string[]): string | null {
  if (!argv.some(isHelpFlag)) return null
  if (isHelpFlag(argv[0])) return rootUsage()
  if (argv[0] !== 'agent') return rootUsage()

  const command = argv[1]
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
  return COMMANDS.includes(value as AgentCommand)
}
