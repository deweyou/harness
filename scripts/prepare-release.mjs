import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_SUBJECT_PREFIX = 'chore(release): v';

export const VERSION_TARGETS = [
  { path: 'package.json', select: (document) => document, label: 'package' },
  { path: '.codex-plugin/plugin.json', select: (document) => document, label: 'Codex plugin' },
  { path: '.claude-plugin/plugin.json', select: (document) => document, label: 'Claude plugin' },
  { path: '.trae-plugin/plugin.json', select: (document) => document, label: 'Trae plugin' },
  {
    path: '.claude-plugin/marketplace.json',
    select: (document) => document.plugins?.find((plugin) => plugin.name === 'deweyou-harness'),
    label: 'Claude marketplace plugin',
  },
  { path: 'plugin.json', select: (document) => document, label: 'portable plugin' },
  { path: 'openclaw.plugin.json', select: (document) => document, label: 'OpenClaw plugin' },
];

export function releaseBump(commits) {
  if (commits.length === 0) return null;
  if (
    commits.some(
      ({ subject, body = '' }) =>
        /^[a-z]+(?:\([^)]*\))?!:/.test(subject) || /(?:^|\n)BREAKING CHANGE:\s/m.test(body),
    )
  ) {
    return 'major';
  }
  if (commits.some(({ subject }) => /^feat(?:\([^)]*\))?:/.test(subject))) return 'minor';
  return 'patch';
}

export function incrementVersion(currentVersion, bump) {
  const match = SEMVER_PATTERN.exec(currentVersion);
  if (!match) throw new Error(`Invalid repository version '${currentVersion}'`);
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unsupported release bump '${bump}'`);
}

export async function synchronizeVersions(repositoryRoot, version) {
  if (!SEMVER_PATTERN.test(version)) throw new Error(`Invalid target version '${version}'`);
  const updatedPaths = [];
  for (const target of VERSION_TARGETS) {
    const targetPath = resolve(repositoryRoot, target.path);
    const document = JSON.parse(await readFile(targetPath, 'utf8'));
    const versionedObject = target.select(document);
    if (!versionedObject) throw new Error(`Cannot find ${target.label} version in ${target.path}`);
    versionedObject.version = version;
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`);
    updatedPaths.push(target.path);
  }
  return updatedPaths;
}

export function prependChangelog(existingContent, version, date, commits) {
  const heading = `## [${version}] - ${date}`;
  if (existingContent.includes(heading)) throw new Error(`CHANGELOG already contains ${heading}`);
  const entries = commits.map(({ hash, subject }) => `- ${subject} (${hash.slice(0, 7)})`).join('\n');
  const releaseSection = `${heading}\n\n${entries}\n`;
  if (!existingContent.trim()) {
    return `# Changelog\n\nAll notable changes to Deweyou Harness are recorded here.\n\n${releaseSection}`;
  }
  const firstRelease = existingContent.search(/^## \[/m);
  if (firstRelease === -1) return `${existingContent.trimEnd()}\n\n${releaseSection}`;
  return `${existingContent.slice(0, firstRelease)}${releaseSection}\n${existingContent.slice(firstRelease)}`;
}

function git(repositoryRoot, args, options = {}) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', ...options }).trim();
}

function isAncestor(repositoryRoot, ancestor, descendant) {
  if (!ancestor || /^0+$/.test(ancestor)) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function latestReleaseCommit(repositoryRoot, head) {
  const records = git(repositoryRoot, ['log', '-n', '200', '--format=%H%x1f%s%x1e', head]);
  return records
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject] = record.split('\x1f');
      return { hash, subject };
    })
    .find(({ subject }) => subject.startsWith(RELEASE_SUBJECT_PREFIX))?.hash;
}

export function releaseCommits(repositoryRoot, base, head = 'HEAD') {
  const releaseBase = latestReleaseCommit(repositoryRoot, head);
  const effectiveBase =
    releaseBase && isAncestor(repositoryRoot, releaseBase, head)
      ? releaseBase
      : isAncestor(repositoryRoot, base, head)
        ? base
        : `${head}^`;
  const raw = git(repositoryRoot, [
    'log',
    '--reverse',
    '--format=%H%x1f%s%x1f%b%x1e',
    `${effectiveBase}..${head}`,
  ]);
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split('\x1f');
      return { hash, subject, body };
    })
    .filter(({ subject }) => !subject.startsWith(RELEASE_SUBJECT_PREFIX));
}

export async function prepareRelease({ repositoryRoot, base, head = 'HEAD', date }) {
  const commits = releaseCommits(repositoryRoot, base, head);
  const bump = releaseBump(commits);
  const packageManifest = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
  if (!bump) return { changed: false, version: packageManifest.version, commits: [] };

  const version = incrementVersion(packageManifest.version, bump);
  await synchronizeVersions(repositoryRoot, version);
  const changelogPath = resolve(repositoryRoot, 'CHANGELOG.md');
  const existingChangelog = await readFile(changelogPath, 'utf8').catch(() => '');
  const releaseDate = date ?? new Date().toISOString().slice(0, 10);
  await writeFile(changelogPath, prependChangelog(existingChangelog, version, releaseDate, commits));
  return { changed: true, version, bump, commits };
}

function parseArguments(argv) {
  const options = { repositoryRoot: process.cwd(), head: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--base') options.base = value;
    else if (argument === '--head') options.head = value;
    else if (argument === '--repository-root') options.repositoryRoot = resolve(value);
    else if (argument === '--github-output') options.githubOutput = value;
    else throw new Error(`Unknown argument '${argument}'`);
    index += 1;
  }
  if (!options.base) throw new Error('--base is required');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await prepareRelease(options);
  if (options.githubOutput) {
    await appendFile(options.githubOutput, `changed=${String(result.changed)}\nversion=${result.version}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
