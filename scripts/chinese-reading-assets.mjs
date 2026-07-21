import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const metadataPattern = /^<!-- Chinese reading companion\n([\s\S]*?)\n-->\n?/

export function discoverChineseReadingAssets(repositoryRoot) {
  return [
    ...discoverSkillCompanions(repositoryRoot),
    ...discoverFlatCompanions(repositoryRoot, 'rules'),
    ...discoverFlatCompanions(repositoryRoot, 'design'),
  ]
}

export function parseChineseCompanion(markdown) {
  const match = markdown.match(metadataPattern)
  if (!match) return { metadata: null, body: markdown }

  const metadata = Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^([a-z-]+):\s*(.+)$/))
      .filter(Boolean)
      .map((lineMatch) => [lineMatch[1], lineMatch[2]]),
  )

  return { metadata, body: markdown.slice(match[0].length) }
}

export function sourceDigest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export function validateChineseReadingAssets(repositoryRoot) {
  const errors = []

  for (const asset of discoverChineseReadingAssets(repositoryRoot)) {
    if (!existsSync(asset.companionPath)) {
      errors.push(`${asset.companionSource}: missing Chinese reading companion for ${asset.source}`)
      continue
    }

    const sourceContent = readFileSync(asset.sourcePath, 'utf8')
    const companionContent = readFileSync(asset.companionPath, 'utf8')
    const { metadata } = parseChineseCompanion(companionContent)

    if (!metadata) {
      errors.push(`${asset.companionSource}: missing Chinese reading companion metadata`)
      continue
    }

    if (metadata.source !== asset.source) {
      errors.push(
        `${asset.companionSource}: source '${metadata.source ?? ''}' does not match '${asset.source}'`,
      )
    }

    if (metadata['translation-status'] !== 'current') {
      errors.push(`${asset.companionSource}: translation-status must be 'current'`)
    }

    if (!metadata.description) {
      errors.push(`${asset.companionSource}: missing Chinese description`)
    }

    const expectedDigest = sourceDigest(sourceContent)
    if (metadata['source-digest'] !== expectedDigest) {
      errors.push(
        `${asset.companionSource}: stale Chinese reading companion; expected source-digest ${expectedDigest}`,
      )
    }
  }

  return errors
}

function discoverSkillCompanions(repositoryRoot) {
  const skillRoot = join(repositoryRoot, 'skills')
  if (!existsSync(skillRoot)) return []

  return readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillRoot, entry.name, 'SKILL.md')))
    .map((entry) => createAsset(repositoryRoot, 'skill', `skills/${entry.name}/SKILL.md`, `skills/${entry.name}/README_ZH.md`))
}

function discoverFlatCompanions(repositoryRoot, kind) {
  const assetRoot = join(repositoryRoot, kind)
  if (!existsSync(assetRoot)) return []

  return readdirSync(assetRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => {
      const name = entry.name.replace(/\.md$/, '')
      return createAsset(
        repositoryRoot,
        kind === 'rules' ? 'rule' : 'design',
        `${kind}/${entry.name}`,
        `docs/zh/assets/${kind}/${name}.md`,
      )
    })
}

function createAsset(repositoryRoot, kind, source, companionSource) {
  return {
    kind,
    source,
    companionSource,
    sourcePath: join(repositoryRoot, ...source.split('/')),
    companionPath: join(repositoryRoot, ...companionSource.split('/')),
  }
}
