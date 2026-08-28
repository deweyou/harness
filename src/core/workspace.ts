import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { invariant } from './errors.js';
import type { WorkspaceStrategy } from './types.js';

const execFileAsync = promisify(execFile);

export interface WorkspacePreparationReceipt {
  schemaVersion: 1;
  id: string;
  strategy: WorkspaceStrategy;
  sourceWorkspacePath: string;
  preparedWorkspacePath: string;
  taskBranch: string;
  remote: string;
  baseBranch: string;
  baseRevision: string;
  preparedRevision: string;
  createdAt: string;
}

export interface PrepareWorkspaceInput {
  workspacePath: string;
  strategy: WorkspaceStrategy;
  taskBranch: string;
  idempotencyKey: string;
  remote?: string;
  baseBranch?: string;
  worktreePath?: string;
}

export interface WorkspacePreparerOptions {
  stateRoot?: string;
  now?: () => Date;
}

interface StoredPreparation {
  fingerprint: string;
  receipt: WorkspacePreparationReceipt;
}

interface WorktreeEntry {
  path: string;
  branch?: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 4 * 1_024 * 1_024,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const detail = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 30_000;
  let handle;
  while (!handle) {
    try {
      handle = await open(path, 'wx', 0o600);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST' || Date.now() >= deadline) throw error;
      await new Promise((accept) => setTimeout(accept, 50));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(path).catch(() => undefined);
  }
}

function parseWorktrees(output: string): WorktreeEntry[] {
  return output.split('\n\n').filter(Boolean).map((block) => {
    const fields = new Map(block.split('\n').map((line) => {
      const separator = line.indexOf(' ');
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const branch = fields.get('branch');
    return { path: fields.get('worktree')!, ...(branch ? { branch } : {}) };
  });
}

function preparationFingerprint(input: Omit<PrepareWorkspaceInput, 'idempotencyKey'> & { workspacePath: string }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class WorkspacePreparer {
  private readonly stateRoot: string;
  private readonly now: () => Date;

  constructor(options: WorkspacePreparerOptions = {}) {
    this.stateRoot = options.stateRoot ?? process.env.DEWEYOU_HARNESS_STATE_ROOT ?? join(homedir(), '.deweyou', 'harness');
    this.now = options.now ?? (() => new Date());
  }

  async prepare(input: PrepareWorkspaceInput): Promise<WorkspacePreparationReceipt> {
    const sourceWorkspacePath = await realpath(resolve(input.workspacePath));
    const repositoryPath = await realpath(await git(sourceWorkspacePath, ['rev-parse', '--show-toplevel']));
    await git(repositoryPath, ['check-ref-format', '--branch', input.taskBranch]);
    const lockIdentity = createHash('sha256').update(repositoryPath).digest('hex');
    return withFileLock(join(this.preparationDirectory(), 'locks', `${lockIdentity}.lock`), async () => {
      const normalized = {
        workspacePath: repositoryPath,
        strategy: input.strategy,
        taskBranch: input.taskBranch,
        ...(input.remote ? { remote: input.remote } : {}),
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
        ...(input.worktreePath ? { worktreePath: resolve(input.worktreePath) } : {}),
      };
      const fingerprint = preparationFingerprint(normalized);
      const replay = await this.readIdempotent(repositoryPath, input.idempotencyKey);
      if (replay) {
        invariant(replay.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT', `Idempotency key '${input.idempotencyKey}' has different workspace preparation input`);
        await this.verify(replay.receipt.id, replay.receipt.preparedWorkspacePath, input.strategy);
        return replay.receipt;
      }

      const remote = await this.resolveRemote(repositoryPath, input.remote);
      const baseBranch = await this.resolveBaseBranch(repositoryPath, remote, input.baseBranch);
      await git(repositoryPath, ['check-ref-format', '--branch', baseBranch]);
      await git(repositoryPath, ['fetch', remote, baseBranch]);
      const remoteBase = `refs/remotes/${remote}/${baseBranch}`;
      const baseRevision = await git(repositoryPath, ['rev-parse', remoteBase]);
      const preparedWorkspacePath = input.strategy === 'branch'
        ? await this.prepareBranch(repositoryPath, input.taskBranch, remoteBase)
        : await this.prepareWorktree(repositoryPath, input.taskBranch, remoteBase, input.worktreePath);
      if (input.strategy === 'worktree') {
        invariant(await this.isLinkedWorktree(preparedWorkspacePath), 'WORKSPACE_STRATEGY_MISMATCH', 'Worktree strategy requires a linked Git worktree');
      }
      const preparedRevision = await git(preparedWorkspacePath, ['rev-parse', 'HEAD']);
      invariant(await git(preparedWorkspacePath, ['branch', '--show-current']) === input.taskBranch, 'WORKSPACE_PREPARATION_INVALID', `Prepared workspace is not on task branch '${input.taskBranch}'`);
      await git(preparedWorkspacePath, ['merge-base', '--is-ancestor', baseRevision, preparedRevision]);

      const receipt: WorkspacePreparationReceipt = {
        schemaVersion: 1,
        id: randomUUID(),
        strategy: input.strategy,
        sourceWorkspacePath: repositoryPath,
        preparedWorkspacePath: await realpath(preparedWorkspacePath),
        taskBranch: input.taskBranch,
        remote,
        baseBranch,
        baseRevision,
        preparedRevision,
        createdAt: this.now().toISOString(),
      };
      await this.writeReceipt(repositoryPath, input.idempotencyKey, { fingerprint, receipt });
      return receipt;
    });
  }

  async verify(receiptId: string, workspacePath: string, strategy: WorkspaceStrategy): Promise<WorkspacePreparationReceipt> {
    const canonicalWorkspace = await realpath(resolve(workspacePath));
    const receipt = await this.readReceipt(receiptId);
    invariant(receipt.strategy === strategy, 'WORKSPACE_STRATEGY_MISMATCH', `Preparation '${receiptId}' used strategy '${receipt.strategy}', not '${strategy}'`);
    invariant(receipt.preparedWorkspacePath === canonicalWorkspace, 'WORKSPACE_RECEIPT_MISMATCH', `Preparation '${receiptId}' belongs to another workspace`);
    invariant(await git(canonicalWorkspace, ['branch', '--show-current']) === receipt.taskBranch, 'WORKSPACE_BRANCH_MISMATCH', `Prepared workspace is no longer on '${receipt.taskBranch}'`);
    invariant(await git(canonicalWorkspace, ['rev-parse', 'HEAD']) === receipt.preparedRevision, 'WORKSPACE_REVISION_MISMATCH', `Prepared workspace HEAD changed after preparation '${receiptId}'`);
    const remoteBase = `refs/remotes/${receipt.remote}/${receipt.baseBranch}`;
    invariant(await git(canonicalWorkspace, ['rev-parse', remoteBase]) === receipt.baseRevision, 'WORKSPACE_BASE_STALE', `Remote base moved after preparation '${receiptId}'; prepare again`);
    await git(canonicalWorkspace, ['merge-base', '--is-ancestor', receipt.baseRevision, receipt.preparedRevision]);
    if (strategy === 'worktree') {
      invariant(await this.isLinkedWorktree(canonicalWorkspace), 'WORKSPACE_STRATEGY_MISMATCH', `Preparation '${receiptId}' is not a linked Git worktree`);
    }
    return receipt;
  }

  private async prepareBranch(repositoryPath: string, taskBranch: string, remoteBase: string): Promise<string> {
    invariant((await git(repositoryPath, ['status', '--porcelain'])).length === 0, 'WORKSPACE_DIRTY', 'Branch strategy requires a clean checkout');
    const branchExists = await gitSucceeds(repositoryPath, ['show-ref', '--verify', '--quiet', `refs/heads/${taskBranch}`]);
    if (branchExists) {
      await git(repositoryPath, ['switch', taskBranch]);
      await this.rebase(repositoryPath, remoteBase);
    } else {
      await git(repositoryPath, ['switch', '-c', taskBranch, remoteBase]);
    }
    return realpath(repositoryPath);
  }

  private async prepareWorktree(repositoryPath: string, taskBranch: string, remoteBase: string, requestedPath?: string): Promise<string> {
    const worktrees = parseWorktrees(await git(repositoryPath, ['worktree', 'list', '--porcelain']));
    const existing = worktrees.find((entry) => entry.branch === `refs/heads/${taskBranch}`);
    if (existing) {
      const existingPath = await realpath(existing.path);
      invariant(await this.isLinkedWorktree(existingPath), 'WORKSPACE_STRATEGY_MISMATCH', `Task branch '${taskBranch}' is checked out in the primary workspace, not a linked worktree`);
      invariant((await git(existingPath, ['status', '--porcelain'])).length === 0, 'WORKSPACE_DIRTY', `Existing task worktree '${existingPath}' is dirty`);
      await this.rebase(existingPath, remoteBase);
      return existingPath;
    }
    const defaultPath = join(this.stateRoot, 'worktrees', createHash('sha256').update(repositoryPath).digest('hex').slice(0, 16), createHash('sha256').update(taskBranch).digest('hex').slice(0, 16));
    const worktreePath = resolve(requestedPath ?? defaultPath);
    const fromRepository = relative(repositoryPath, worktreePath);
    invariant(fromRepository === '..' || fromRepository.startsWith(`..${sep}`) || isAbsolute(fromRepository), 'WORKTREE_PATH_INVALID', 'Task worktree path must be outside the source checkout');
    await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 });
    const branchExists = await gitSucceeds(repositoryPath, ['show-ref', '--verify', '--quiet', `refs/heads/${taskBranch}`]);
    if (branchExists) {
      await git(repositoryPath, ['worktree', 'add', worktreePath, taskBranch]);
      await this.rebase(worktreePath, remoteBase);
    } else {
      await git(repositoryPath, ['worktree', 'add', '-b', taskBranch, worktreePath, remoteBase]);
    }
    return realpath(worktreePath);
  }

  private async rebase(workspacePath: string, remoteBase: string): Promise<void> {
    try {
      await git(workspacePath, ['rebase', remoteBase]);
    } catch (error) {
      await tryGit(workspacePath, ['rebase', '--abort']);
      throw error;
    }
  }

  private async isLinkedWorktree(workspacePath: string): Promise<boolean> {
    const gitDirectory = await realpath(resolve(workspacePath, await git(workspacePath, ['rev-parse', '--git-dir'])));
    const commonDirectory = await realpath(resolve(workspacePath, await git(workspacePath, ['rev-parse', '--git-common-dir'])));
    return gitDirectory !== commonDirectory;
  }

  private async resolveRemote(repositoryPath: string, requested?: string): Promise<string> {
    const remotes = (await git(repositoryPath, ['remote'])).split('\n').filter(Boolean);
    if (requested) {
      invariant(remotes.includes(requested), 'WORKSPACE_REMOTE_NOT_FOUND', `Git remote '${requested}' does not exist`);
      return requested;
    }
    const upstream = await tryGit(repositoryPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (upstream?.includes('/')) return upstream.slice(0, upstream.indexOf('/'));
    if (remotes.includes('origin')) return 'origin';
    invariant(remotes.length === 1, 'WORKSPACE_REMOTE_AMBIGUOUS', 'Specify a remote because the repository has no unambiguous default');
    return remotes[0]!;
  }

  private async resolveBaseBranch(repositoryPath: string, remote: string, requested?: string): Promise<string> {
    if (requested) return requested.startsWith(`${remote}/`) ? requested.slice(remote.length + 1) : requested;
    const remoteHead = await tryGit(repositoryPath, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]);
    invariant(typeof remoteHead === 'string' && remoteHead.startsWith(`${remote}/`), 'WORKSPACE_BASE_AMBIGUOUS', `Remote '${remote}' has no default branch; specify baseBranch`);
    return remoteHead.slice(remote.length + 1);
  }

  private preparationDirectory(): string {
    return join(this.stateRoot, 'preparations');
  }

  private async readIdempotent(repositoryPath: string, idempotencyKey: string): Promise<StoredPreparation | undefined> {
    const identity = createHash('sha256').update(`${repositoryPath}\0${idempotencyKey}`).digest('hex');
    try {
      return JSON.parse(await readFile(join(this.preparationDirectory(), 'idempotency', `${identity}.json`), 'utf8')) as StoredPreparation;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readReceipt(receiptId: string): Promise<WorkspacePreparationReceipt> {
    invariant(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receiptId), 'WORKSPACE_PREPARATION_NOT_FOUND', `Workspace preparation '${receiptId}' does not exist`);
    try {
      return JSON.parse(await readFile(join(this.preparationDirectory(), `${receiptId}.json`), 'utf8')) as WorkspacePreparationReceipt;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      invariant(code !== 'ENOENT', 'WORKSPACE_PREPARATION_NOT_FOUND', `Workspace preparation '${receiptId}' does not exist`);
      throw error;
    }
  }

  private async writeReceipt(repositoryPath: string, idempotencyKey: string, stored: StoredPreparation): Promise<void> {
    const directory = this.preparationDirectory();
    await mkdir(join(directory, 'idempotency'), { recursive: true, mode: 0o700 });
    await atomicJson(join(directory, `${stored.receipt.id}.json`), stored.receipt);
    const identity = createHash('sha256').update(`${repositoryPath}\0${idempotencyKey}`).digest('hex');
    await atomicJson(join(directory, 'idempotency', `${identity}.json`), stored);
  }
}
