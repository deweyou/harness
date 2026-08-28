import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { WorkspacePreparer } from '../src/core/workspace.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function repositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-workspace-'));
  const remote = join(root, 'remote.git');
  const repository = join(root, 'repository');
  const stateRoot = join(root, 'state');
  await mkdir(repository);
  await git(root, 'init', '--bare', remote);
  await git(repository, 'init', '-b', 'main');
  await writeFile(join(repository, 'harness.yaml'), 'version: 3\nstrategy: worktree\n');
  await git(repository, 'add', 'harness.yaml');
  await git(repository, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'initial');
  await git(repository, 'remote', 'add', 'origin', remote);
  await git(repository, 'push', '-u', 'origin', 'main');
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await git(repository, 'remote', 'set-head', 'origin', 'main');
  return { repository, root, stateRoot };
}

describe('WorkspacePreparer', () => {
  it('prepares and verifies a linked worktree from the fetched base', async () => {
    const { repository, root, stateRoot } = await repositoryFixture();
    const preparer = new WorkspacePreparer({ stateRoot, now: () => new Date('2026-08-25T00:00:00.000Z') });
    const receipt = await preparer.prepare({
      workspacePath: repository,
      strategy: 'worktree',
      taskBranch: 'codex/export-viewer',
      baseBranch: 'main',
      worktreePath: join(root, 'task-worktree'),
      idempotencyKey: 'prepare-worktree',
    });

    expect(receipt).toMatchObject({ strategy: 'worktree', taskBranch: 'codex/export-viewer', baseBranch: 'main' });
    expect(await git(receipt.preparedWorkspacePath, 'branch', '--show-current')).toBe('codex/export-viewer');
    await expect(preparer.verify(receipt.id, receipt.preparedWorkspacePath, 'worktree')).resolves.toEqual(receipt);
    await expect(preparer.prepare({
      workspacePath: repository,
      strategy: 'worktree',
      taskBranch: 'codex/export-viewer',
      baseBranch: 'main',
      worktreePath: join(root, 'task-worktree'),
      idempotencyKey: 'prepare-worktree',
    })).resolves.toEqual(receipt);
    await expect(preparer.verify(receipt.id, receipt.preparedWorkspacePath, 'branch')).rejects.toMatchObject({ code: 'WORKSPACE_STRATEGY_MISMATCH' });

    await writeFile(join(repository, 'base-update.txt'), 'new base\n');
    await git(repository, 'add', 'base-update.txt');
    await git(repository, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'advance base');
    await git(repository, 'push', 'origin', 'main');
    const rebased = await preparer.prepare({
      workspacePath: repository,
      strategy: 'worktree',
      taskBranch: 'codex/export-viewer',
      baseBranch: 'main',
      worktreePath: join(root, 'task-worktree'),
      idempotencyKey: 'rebase-worktree',
    });
    expect(rebased.baseRevision).not.toBe(receipt.baseRevision);
    expect(rebased.preparedRevision).toBe(rebased.baseRevision);
    await expect(preparer.verify(rebased.id, rebased.preparedWorkspacePath, 'worktree')).resolves.toEqual(rebased);
  });

  it('prepares a branch in a clean checkout and detects a changed HEAD', async () => {
    const { repository, stateRoot } = await repositoryFixture();
    await writeFile(join(repository, 'harness.yaml'), 'version: 3\nstrategy: branch\n');
    await git(repository, 'add', 'harness.yaml');
    await git(repository, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'branch strategy');
    await git(repository, 'push', 'origin', 'main');
    const preparer = new WorkspacePreparer({ stateRoot });
    const receipt = await preparer.prepare({
      workspacePath: repository,
      strategy: 'branch',
      taskBranch: 'codex/branch-task',
      baseBranch: 'main',
      idempotencyKey: 'prepare-branch',
    });
    expect(receipt.preparedWorkspacePath).toBe(await realpath(repository));
    await writeFile(join(repository, 'change.txt'), 'changed\n');
    await git(repository, 'add', 'change.txt');
    await git(repository, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '-m', 'change head');
    await expect(preparer.verify(receipt.id, repository, 'branch')).rejects.toMatchObject({ code: 'WORKSPACE_REVISION_MISMATCH' });
  });

  it('refuses branch preparation from a dirty checkout', async () => {
    const { repository, stateRoot } = await repositoryFixture();
    await writeFile(join(repository, 'dirty.txt'), 'dirty\n');
    await expect(new WorkspacePreparer({ stateRoot }).prepare({
      workspacePath: repository,
      strategy: 'branch',
      taskBranch: 'codex/dirty-task',
      baseBranch: 'main',
      idempotencyKey: 'prepare-dirty',
    })).rejects.toMatchObject({ code: 'WORKSPACE_DIRTY' });
  });

  it('does not treat the primary checkout as a worktree receipt', async () => {
    const { repository, root, stateRoot } = await repositoryFixture();
    await git(repository, 'switch', '-c', 'codex/primary-task', 'origin/main');
    await expect(new WorkspacePreparer({ stateRoot }).prepare({
      workspacePath: repository,
      strategy: 'worktree',
      taskBranch: 'codex/primary-task',
      baseBranch: 'main',
      worktreePath: join(root, 'separate-worktree'),
      idempotencyKey: 'prepare-primary-as-worktree',
    })).rejects.toMatchObject({ code: 'WORKSPACE_STRATEGY_MISMATCH' });
  });
});
