import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { afterEach, describe, expect, test } from 'vitest';
import {
  incrementVersion,
  prepareRelease,
  prependChangelog,
  releaseBump,
  synchronizeVersions,
  VERSION_TARGETS,
} from '../scripts/prepare-release.mjs';

const temporaryDirectories = [];

async function writeVersionFixtures(root, version = '0.1.0') {
  for (const target of VERSION_TARGETS) {
    await mkdir(dirname(join(root, target.path)), { recursive: true });
    const document =
      target.path === '.claude-plugin/marketplace.json'
        ? { plugins: [{ name: 'deweyou-harness', version }] }
        : { name: 'deweyou-harness', version };
    await writeFile(join(root, target.path), `${JSON.stringify(document)}\n`);
  }
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('release automation', () => {
  test('selects the highest conventional-commit bump with a patch fallback', () => {
    expect(releaseBump([])).toBeNull();
    expect(releaseBump([{ subject: 'docs: clarify install' }])).toBe('patch');
    expect(releaseBump([{ subject: 'fix: repair dispatch' }, { subject: 'feat: add adapter' }])).toBe('minor');
    expect(releaseBump([{ subject: 'feat(core)!: replace state format' }])).toBe('major');
    expect(releaseBump([{ subject: 'fix: state', body: 'BREAKING CHANGE: reset format' }])).toBe('major');
  });

  test('increments strict semantic versions', () => {
    expect(incrementVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(incrementVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(incrementVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(() => incrementVersion('latest', 'patch')).toThrow("Invalid repository version 'latest'");
  });

  test('synchronizes every distributable manifest version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-release-'));
    temporaryDirectories.push(root);
    await writeVersionFixtures(root);

    await expect(synchronizeVersions(root, '1.4.0')).resolves.toHaveLength(VERSION_TARGETS.length);
    for (const target of VERSION_TARGETS) {
      const document = JSON.parse(await readFile(join(root, target.path), 'utf8'));
      expect(target.select(document)?.version).toBe('1.4.0');
    }
  });

  test('prepends a release without overwriting prior changelog entries', () => {
    const existing = '# Changelog\n\nIntro.\n\n## [0.1.0] - 2026-08-18\n\n- Initial release.\n';
    const updated = prependChangelog(existing, '0.2.0', '2026-08-19', [
      { hash: 'abcdef123456', subject: 'feat: automate releases' },
    ]);
    expect(updated.indexOf('## [0.2.0]')).toBeLessThan(updated.indexOf('## [0.1.0]'));
    expect(updated).toContain('- feat: automate releases (abcdef1)');
    expect(updated).toContain('- Initial release.');
  });

  test('releases only commits after the latest release marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-release-git-'));
    temporaryDirectories.push(root);
    await writeVersionFixtures(root);
    await writeFile(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [0.1.0] - 2026-08-18\n\n- Initial.\n');
    git(root, 'init');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'chore(release): v0.1.0 [skip ci]');
    const releaseCommit = git(root, 'rev-parse', 'HEAD');
    await writeFile(join(root, 'feature.txt'), 'adapter\n');
    git(root, 'add', 'feature.txt');
    git(root, 'commit', '-m', 'feat: add another host adapter');

    const result = await prepareRelease({
      repositoryRoot: root,
      base: `${releaseCommit}^`,
      date: '2026-08-19',
    });

    expect(result).toMatchObject({ changed: true, version: '0.2.0', bump: 'minor' });
    expect(result.commits.map((commit) => commit.subject)).toEqual(['feat: add another host adapter']);
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version).toBe('0.2.0');
    expect(await readFile(join(root, 'CHANGELOG.md'), 'utf8')).toMatch(
      /## \[0\.2\.0\] - 2026-08-19[\s\S]*feat: add another host adapter/,
    );

    git(root, 'add', '.');
    git(root, 'commit', '-m', 'chore(release): v0.2.0 [skip ci]');
    await expect(
      prepareRelease({ repositoryRoot: root, base: releaseCommit, date: '2026-08-19' }),
    ).resolves.toMatchObject({ changed: false, version: '0.2.0', commits: [] });
  });

  test('declares a serialized, write-enabled, loop-safe main release workflow', async () => {
    const workflow = loadYaml(await readFile('.github/workflows/release.yml', 'utf8'));
    expect(workflow).toMatchObject({
      permissions: { contents: 'write' },
      concurrency: { group: 'release-main', 'cancel-in-progress': false },
      jobs: { release: { 'runs-on': 'ubuntu-latest' } },
    });
    expect(workflow.jobs.release.if).toContain("!startsWith(github.event.head_commit.message, 'chore(release):')");
    const commitStep = workflow.jobs.release.steps.find((step) => step.name === 'Commit release artifacts');
    expect(commitStep.run).toContain('git push origin HEAD:main');
    expect(commitStep.run).toContain('[skip ci]');
  });
});
