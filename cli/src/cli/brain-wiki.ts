import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import yaml from 'js-yaml'

import { brainPaths, loadBrainConfig } from './brain-config.ts'
import { indexBrain } from './brain-index.ts'
import { maxClassification } from './brain-schema.ts'
import type {
  Classification,
  WikiCompileResult,
} from './brain-types.ts'
import { writeFileAtomic } from './safe-io.ts'

const { dump: dumpYaml } = yaml

interface ClaimRow {
  id: string
  title: string
  body: string
  path: string
  classification: Classification
  status: 'active' | 'stale'
  authority: string
  confidence: number | null
  updated_at: string | null
  scopes: string
}

export async function compileWiki({
  homeDir,
}: {
  homeDir?: string
} = {}): Promise<WikiCompileResult> {
  const config = await loadBrainConfig({ homeDir })
  await indexBrain({ homeDir })
  const paths = brainPaths(homeDir)
  const database = new DatabaseSync(paths.databasePath, { readOnly: true })
  let claims: ClaimRow[]
  try {
    claims = database.prepare(`
      SELECT
        a.id, a.title, a.body, a.path, a.classification, a.status,
        a.authority, a.confidence, a.updated_at,
        (SELECT json_group_array(scope) FROM artifact_scopes WHERE artifact_id = a.id) AS scopes
      FROM artifacts a
      WHERE a.type = 'claim' AND a.status IN ('active', 'stale')
      ORDER BY a.id
    `).all() as unknown as ClaimRow[]
  } finally {
    database.close()
  }

  const byDomain = new Map<string, ClaimRow[]>()
  for (const claim of claims) {
    const domain = domainForScopes(JSON.parse(claim.scopes) as string[])
    const domainClaims = byDomain.get(domain) ?? []
    domainClaims.push(claim)
    byDomain.set(domain, domainClaims)
  }

  const pages: string[] = []
  for (const [domain, domainClaims] of [...byDomain].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const pagePath = join(config.knowledge_repo, 'wiki', 'domains', domain, 'index.md')
    await writeIfChanged(pagePath, renderDomainPage(domain, domainClaims))
    pages.push(pagePath)
  }
  const indexPath = join(config.knowledge_repo, 'wiki', 'index.md')
  await writeIfChanged(indexPath, renderWikiIndex(byDomain))
  pages.unshift(indexPath)
  await indexBrain({ homeDir })

  return { pages, claims: claims.length }
}

function renderDomainPage(domain: string, claims: ClaimRow[]): string {
  const classifications = claims.map((claim) => claim.classification)
  const classification = maxClassification(classifications)
  const scopes = [
    ...new Set(claims.flatMap((claim) => JSON.parse(claim.scopes) as string[])),
  ].sort()
  const updatedAt = maximumTimestamp(claims)
  const frontmatter = {
    id: `wiki-domain-${domain}`,
    type: 'wiki',
    title: titleCase(domain),
    classification,
    scope: scopes,
    status: 'active',
    generated: true,
    updated_at: updatedAt,
  }
  const body = claims
    .map((claim) => {
      const warning = claim.status === 'stale' ? ' — **possibly stale**' : ''
      const confidence =
        claim.confidence === null ? '' : `, confidence ${claim.confidence.toFixed(2)}`
      return `## ${claim.title}${warning}

${claim.body.trim()}

_Claim [${claim.id}](../../../${claim.path}), authority ${claim.authority}${confidence}._
`
    })
    .join('\n')
  return `---\n${dumpYaml(frontmatter, {
    noRefs: true,
    lineWidth: 100,
  })}---\n\n# ${titleCase(domain)}\n\n${body}`
}

function renderWikiIndex(byDomain: Map<string, ClaimRow[]>): string {
  const allClaims = [...byDomain.values()].flat()
  const classification = maxClassification(
    allClaims.map((claim) => claim.classification),
  )
  const scopes = [
    ...new Set(
      allClaims.flatMap((claim) => JSON.parse(claim.scopes) as string[]),
    ),
  ].sort()
  const updatedAt = maximumTimestamp(allClaims)
  const frontmatter = {
    id: 'wiki-index',
    type: 'catalog',
    title: 'Personal Context Hub',
    classification,
    scope: scopes.length > 0 ? scopes : ['personal'],
    status: 'active',
    generated: true,
    updated_at: updatedAt,
  }
  const domains =
    [...byDomain]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([domain, claims]) =>
          `- [${titleCase(domain)}](domains/${domain}/index.md) — ${claims.length} claims`,
      )
      .join('\n') || '- No governed claims yet.'
  return `---\n${dumpYaml(frontmatter, {
    noRefs: true,
    lineWidth: 100,
  })}---\n\n# Personal Context Hub\n\n## Domains\n\n${domains}\n`
}

function maximumTimestamp(claims: ClaimRow[]): string {
  return claims
    .map((claim) => claim.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? '1970-01-01T00:00:00.000Z'
}

function domainForScopes(scopes: string[]): string {
  const domain = scopes.find((scope) => scope.startsWith('domain/'))
  if (domain) return safeDomain(domain.slice('domain/'.length))
  const project = scopes.find((scope) => scope.startsWith('project/'))
  if (project) return safeDomain(`project-${project.slice('project/'.length)}`)
  const repo = scopes.find((scope) => scope.startsWith('repo/'))
  if (repo) return safeDomain(`repo-${repo.slice('repo/'.length)}`)
  return 'personal'
}

function safeDomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'personal'
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  try {
    if (await readFile(path, 'utf8') === content) return
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      /* v8 ignore next -- unexpected file read errors must surface unchanged. */
      throw error
    }
  }
  await writeFileAtomic(path, content)
}
