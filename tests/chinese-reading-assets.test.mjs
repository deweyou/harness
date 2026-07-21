import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  parseChineseCompanion,
  sourceDigest,
  validateChineseReadingAssets,
} from '../scripts/chinese-reading-assets.mjs'

const repositoryRoot = new URL('..', import.meta.url).pathname

test('all executable assets have current Chinese reading companions', () => {
  assert.deepEqual(validateChineseReadingAssets(repositoryRoot), [])
})

test('parses companion metadata separately from the readable body', () => {
  const markdown = `<!-- Chinese reading companion
source: rules/demo.md
source-digest: sha256:${'a'.repeat(64)}
translation-status: current
description: 示例规则。
-->

# 示例
`
  const parsed = parseChineseCompanion(markdown)

  assert.equal(parsed.metadata.source, 'rules/demo.md')
  assert.equal(parsed.metadata.description, '示例规则。')
  assert.match(parsed.body, /^\n# 示例/)
})

test('reports stale and missing Chinese reading companions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-chinese-reading-'))
  const skillSource = '# Demo skill\n'

  await mkdir(join(root, 'skills/demo'), { recursive: true })
  await mkdir(join(root, 'rules'), { recursive: true })
  await writeFile(join(root, 'skills/demo/SKILL.md'), skillSource)
  await writeFile(
    join(root, 'skills/demo/README_ZH.md'),
    `<!-- Chinese reading companion
source: skills/demo/SKILL.md
source-digest: ${sourceDigest(`${skillSource}changed`)}
translation-status: current
description: 示例 Skill。
-->

# 示例
`,
  )
  await writeFile(join(root, 'rules/example.md'), '# Example rule\n')

  const errors = validateChineseReadingAssets(root)

  assert.equal(errors.length, 2)
  assert.match(errors[0], /stale Chinese reading companion/)
  assert.match(errors[1], /missing Chinese reading companion/)
})
