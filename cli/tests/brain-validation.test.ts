import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import {
  createBrainConfig,
  loadBrainConfig,
  validateBrainConfig,
} from '../src/cli/brain-config.ts'
import {
  maxClassification,
  parseArtifactStatus,
  parseBrainMarkdown,
  parseClassification,
  parseScopes,
} from '../src/cli/brain-schema.ts'
import { captureBrainEvent, initBrain } from '../src/cli/brain.ts'

describe('brain configuration and schema validation', () => {
  it('applies configuration defaults and rejects unsafe configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-config-'))
    await assert.rejects(loadBrainConfig({ homeDir: root }), /not initialized/)

    const config = createBrainConfig({
      repoPath: join(root, 'knowledge'),
      deviceId: 'device-a',
    })
    assert.equal(config.sync.branch, 'main')
    assert.deepEqual(
      validateBrainConfig({
        schema_version: 1,
        knowledge_repo: config.knowledge_repo,
        device_id: 'device-a',
        sync: {
          encryption: 'none',
          profile: 'full',
        },
        defaults: {},
        compiler: {
          provider: 'none',
        },
      }),
      config,
    )

    const invalid: Array<[unknown, RegExp]> = [
      [null, /must be an object/],
      [{}, /schema_version/],
      [{ ...config, sync: null }, /\.sync must be an object/],
      [
        { ...config, sync: { ...config.sync, encryption: 'all' } },
        /reserved but not implemented/,
      ],
      [
        { ...config, sync: { ...config.sync, enabled: 'yes' } },
        /boolean value is invalid/,
      ],
      [
        { ...config, defaults: { ...config.defaults, token_budget: 0 } },
        /positive integer/,
      ],
      [
        { ...config, compiler: { ...config.compiler, command: 'node' } },
        /string array/,
      ],
      [{ ...config, device_id: 'Bad Device' }, /filesystem-safe/],
      [{ ...config, knowledge_repo: '' }, /non-empty string/],
      [
        { ...config, sync: { ...config.sync, profile: 'partial' } },
        /must be one of/,
      ],
    ]
    for (const [value, pattern] of invalid) {
      assert.throws(() => validateBrainConfig(value), pattern)
    }
  })

  it('validates Markdown, scope, classification, and status variants', () => {
    assert.equal(parseClassification('public'), 'public')
    assert.throws(() => parseClassification('PUBLIC'), /Invalid classification/)
    assert.throws(() => parseClassification(3), /Invalid classification/)
    assert.equal(parseArtifactStatus('stale'), 'stale')
    assert.throws(() => parseArtifactStatus('gone'), /Invalid artifact status/)
    assert.deepEqual(parseScopes('personal'), ['personal'])
    assert.deepEqual(parseScopes(['personal', 'personal']), ['personal'])
    assert.throws(() => parseScopes([]), /Invalid scope/)
    assert.throws(() => parseScopes(['Bad Scope']), /Invalid scope/)
    assert.equal(maxClassification([]), 'private')
    assert.equal(maxClassification(['public', 'restricted']), 'restricted')
    assert.throws(
      () =>
        parseBrainMarkdown({
          path: 'claims/no-frontmatter.md',
          contents: '# Missing metadata',
          defaults: { classification: 'private', scopes: ['personal'] },
        }),
      /missing YAML frontmatter/,
    )
    assert.throws(
      () =>
        parseBrainMarkdown({
          path: 'claims/no-id.md',
          contents: '---\ntype: claim\n---\nbody',
          defaults: { classification: 'private', scopes: ['personal'] },
        }),
      /id must be a non-empty string/,
    )
    const inherited = parseBrainMarkdown({
      path: 'claims/inherited.md',
      contents: `---
id: inherited
type: claim
---

# Heading fallback

Body.
`,
      defaults: { classification: 'confidential', scopes: ['domain/reading'] },
    })
    assert.equal(inherited.title, 'Heading fallback')
    assert.equal(inherited.classification, 'confidential')
    assert.deepEqual(inherited.scopes, ['domain/reading'])
    assert.equal(inherited.status, 'active')
    assert.equal(inherited.authority, 'unknown')
    assert.equal(inherited.confidence, null)
    const idTitle = parseBrainMarkdown({
      path: 'claims/id-title.md',
      contents: '---\nid: id-title\ntype: claim\n---\nBody without heading.\n',
      defaults: { classification: 'private', scopes: ['personal'] },
    })
    assert.equal(idTitle.title, 'id-title')
    assert.throws(
      () =>
        parseBrainMarkdown({
          path: 'claims/scalar.md',
          contents: '---\nscalar\n---\nbody\n',
          defaults: { classification: 'private', scopes: ['personal'] },
        }),
      /frontmatter must be an object/,
    )
  })

  it('rejects malformed capture input and always preserves existing templates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-capture-invalid-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(join(repoPath, 'AGENTS.md'), '# Custom\n')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    assert.throws(
      () => parseClassification('secret'),
      /Invalid classification/,
    )
    await assert.rejects(
      captureBrainEvent({
        homeDir,
        agent: 'unknown',
        eventType: 'stop',
      }),
      /must be one of/,
    )
    await assert.rejects(
      captureBrainEvent({
        homeDir,
        agent: 'codex',
        eventType: 'Invalid Event',
      }),
      /safe identifier/,
    )
    await assert.rejects(
      captureBrainEvent({
        homeDir,
        agent: 'codex',
        eventType: 'stop',
        data: '[]',
      }),
      /must be a JSON object/,
    )
    await assert.rejects(
      captureBrainEvent({
        homeDir,
        agent: 'codex',
        eventType: 'stop',
        data: '{bad',
      }),
      /Invalid Brain capture JSON/,
    )
    await assert.rejects(
      captureBrainEvent({
        homeDir,
        agent: 'codex',
        eventType: 'stop',
        data: JSON.stringify({ value: 'x'.repeat(11 * 1024 * 1024) }),
      }),
      /exceeds/,
    )
  })
})
