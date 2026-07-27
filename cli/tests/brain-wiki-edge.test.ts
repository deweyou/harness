import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import { compileWiki } from '../src/cli/brain-wiki.ts'
import { initBrain } from '../src/cli/brain.ts'

describe('brain Wiki domain compilation', () => {
  it('routes project and repo scopes and labels stale claims without confidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-wiki-edge-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      join(repoPath, 'claims', 'project.md'),
      claim('project-claim', 'Project fact', 'project/demo', 'stale'),
    )
    await writeFile(
      join(repoPath, 'claims', 'repo.md'),
      claim('repo-claim', 'Repository fact', 'repo/agents', 'active'),
    )

    await compileWiki({ homeDir })
    const project = await readFile(
      join(repoPath, 'wiki/domains/project-demo/index.md'),
      'utf8',
    )
    const repo = await readFile(
      join(repoPath, 'wiki/domains/repo-agents/index.md'),
      'utf8',
    )
    assert.match(project, /possibly stale/)
    assert.doesNotMatch(project, /confidence/)
    assert.match(repo, /Repository fact/)
  })
})

function claim(
  id: string,
  title: string,
  scope: string,
  status: 'active' | 'stale',
): string {
  return `---
id: ${id}
type: claim
title: ${title}
classification: private
scope: [${scope}]
status: ${status}
authority: user
---

${title} body.
`
}
