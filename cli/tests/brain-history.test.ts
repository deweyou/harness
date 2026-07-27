import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'

import {
  discoverBrainHistory,
  importDiscoveredBrainHistory,
} from '../src/cli/brain-history.ts'
import { initBrain } from '../src/cli/brain.ts'
import { brainPaths } from '../src/cli/brain-config.ts'

describe('brain native history discovery and import', () => {
  it('discovers Codex JSONL and Hermes SQLite plus legacy sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-discovery-'))
    const homeDir = join(root, 'home')
    const codexCurrent = join(homeDir, '.codex', 'sessions', '2026', '07', '27')
    const codexArchived = join(homeDir, '.codex', 'archived_sessions')
    const hermesSessions = join(homeDir, '.hermes', 'sessions')
    await mkdir(codexCurrent, { recursive: true })
    await mkdir(codexArchived, { recursive: true })
    await mkdir(hermesSessions, { recursive: true })
    await writeFile(join(codexCurrent, 'current.jsonl'), codexSession('codex-current'))
    await writeFile(join(codexArchived, 'archived.jsonl'), codexSession('codex-archived'))
    await writeFile(
      join(hermesSessions, 'legacy.jsonl'),
      '{"role":"user","content":"legacy Hermes history"}\n',
    )
    createHermesDatabase(join(homeDir, '.hermes', 'state.db'))

    const discovered = await discoverBrainHistory({ homeDir, agent: 'all' })

    assert.equal(discovered.files, 4)
    assert.equal(discovered.records, 4)
    assert.ok(discovered.source_bytes > 0)
    assert.deepEqual(discovered.warnings, [])
    assert.deepEqual(
      discovered.sources.map((source) => source.kind).sort(),
      ['codex-jsonl', 'codex-jsonl', 'hermes-jsonl', 'hermes-sqlite'],
    )
    assert.equal(
      (await discoverBrainHistory({ homeDir, agent: 'codex' })).records,
      2,
    )
    assert.equal(
      (await discoverBrainHistory({
        homeDir,
        agent: 'all',
        environment: {
          CODEX_HOME: join(homeDir, '.codex'),
          HERMES_HOME: join(homeDir, '.hermes'),
        },
      })).records,
      4,
    )
  })

  it('previews and idempotently imports normalized native histories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-native-import-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const codexSessions = join(homeDir, '.codex', 'sessions', '2026', '07', '27')
    const hermesHome = join(homeDir, '.hermes')
    await mkdir(codexSessions, { recursive: true })
    await mkdir(hermesHome, { recursive: true })
    await writeFile(join(codexSessions, 'session.jsonl'), codexSession('codex-1'))
    createHermesDatabase(join(hermesHome, 'state.db'))
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-a' })

    const preview = await importDiscoveredBrainHistory({
      homeDir,
      agent: 'all',
      dryRun: true,
    })
    assert.equal(preview.dryRun, true)
    assert.equal(preview.discovery.records, 2)
    assert.deepEqual(preview.scopes, ['device/macbook-a'])
    assert.equal(preview.totals.captured, 0)

    const first = await importDiscoveredBrainHistory({
      homeDir,
      agent: 'all',
    })
    assert.equal(first.totals.captured, 2)
    assert.equal(first.totals.deduplicated, 0)
    const second = await importDiscoveredBrainHistory({
      homeDir,
      agent: 'all',
    })
    assert.equal(second.totals.captured, 0)
    assert.equal(second.totals.deduplicated, 2)

    const sourceFiles = await findJsonFiles(
      join(brainPaths(homeDir).rawSourcesRoot, 'sessions'),
    )
    const sourceRecords = await Promise.all(
      sourceFiles.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
    )
    assert.ok(
      sourceRecords.every((source) =>
        source.scopes.includes('device/macbook-a')
      ),
    )
    const importedText = sourceRecords
      .map((source) => JSON.stringify(source.content))
      .join('\n')
    assert.match(importedText, /Codex user question/)
    assert.match(importedText, /Codex final answer/)
    assert.match(importedText, /Hermes user question/)
    assert.match(importedText, /Hermes final answer/)
    assert.doesNotMatch(importedText, /developer instructions/)
    assert.doesNotMatch(importedText, /tool output should be excluded/)
    assert.doesNotMatch(importedText, /private reasoning/)
  })

  it('discovers Hermes profiles and rejects an incompatible database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-profile-discovery-'))
    const homeDir = join(root, 'home')
    const profileHome = join(homeDir, '.hermes', 'profiles', 'work')
    const hiddenProfile = join(homeDir, '.hermes', 'profiles', '.hidden')
    await mkdir(profileHome, { recursive: true })
    await mkdir(hiddenProfile, { recursive: true })
    createHermesDatabase(join(profileHome, 'state.db'))
    createHermesDatabase(join(hiddenProfile, 'state.db'))

    const discovered = await discoverBrainHistory({
      homeDir,
      agent: 'hermes',
    })
    assert.equal(discovered.records, 1)
    assert.equal(discovered.sources[0].path, join(profileHome, 'state.db'))

    const invalidDatabase = join(homeDir, '.hermes', 'state.db')
    const database = new DatabaseSync(invalidDatabase)
    database.exec('CREATE TABLE unrelated (id TEXT);')
    database.close()
    const withInvalidDatabase = await discoverBrainHistory({
      homeDir,
      agent: 'hermes',
    })
    assert.equal(withInvalidDatabase.records, 1)
    assert.match(
      withInvalidDatabase.warnings[0],
      /required sessions and messages tables are missing/,
    )
  })

  it('imports the Codex response-item fallback without local metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-codex-fallback-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const sessionRoot = join(homeDir, '.codex', 'sessions')
    await mkdir(sessionRoot, { recursive: true })
    await writeFile(
      join(sessionRoot, 'fallback.jsonl'),
      [
        'not json',
        JSON.stringify({
          timestamp: 'invalid timestamp',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Fallback user message' },
              { type: 'image', value: 'excluded' },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [
              { type: 'output_text', text: 'Fallback final answer' },
            ],
          },
        }),
      ].join('\n'),
    )
    await initBrain({ homeDir, repoPath, deviceId: 'macbook-fallback' })

    const result = await importDiscoveredBrainHistory({
      homeDir,
      agent: 'codex',
    })

    assert.equal(result.totals.captured, 1)
    const sourceFiles = await findJsonFiles(
      join(brainPaths(homeDir).rawSourcesRoot, 'sessions'),
    )
    const imported = await readFile(sourceFiles[0], 'utf8')
    assert.match(imported, /Fallback user message/)
    assert.match(imported, /Fallback final answer/)
    assert.doesNotMatch(imported, /excluded/)
  })

  it('handles missing homes and rejects unsupported discovery agents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-empty-discovery-'))
    assert.deepEqual(
      await discoverBrainHistory({ homeDir: root, agent: 'all' }),
      {
        agents: ['codex', 'hermes'],
        sources: [],
        files: 0,
        records: 0,
        source_bytes: 0,
        warnings: [],
      },
    )
    await assert.rejects(
      discoverBrainHistory({ homeDir: root, agent: 'claude' }),
      /supports codex, hermes, or all/,
    )
  })
})

function codexSession(id: string): string {
  return [
    {
      timestamp: '2026-07-27T01:00:00.000Z',
      type: 'session_meta',
      payload: {
        id,
        timestamp: '2026-07-27T01:00:00.000Z',
        cwd: '/private/work/repository',
      },
    },
    {
      timestamp: '2026-07-27T01:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'developer instructions' }],
      },
    },
    {
      timestamp: '2026-07-27T01:00:02.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: 'Codex user question',
      },
    },
    {
      timestamp: '2026-07-27T01:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        output: 'tool output should be excluded',
      },
    },
    {
      timestamp: '2026-07-27T01:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'private reasoning' }],
      },
    },
    {
      timestamp: '2026-07-27T01:00:05.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: 'final_answer',
        message: 'Codex final answer',
      },
    },
  ].map((value) => JSON.stringify(value)).join('\n') + '\n'
}

function createHermesDatabase(path: string): void {
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      model TEXT,
      title TEXT,
      parent_session_id TEXT,
      started_at REAL NOT NULL,
      ended_at REAL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      timestamp REAL NOT NULL,
      reasoning TEXT
    );
    INSERT INTO sessions (
      id, source, model, title, parent_session_id, started_at, ended_at
    ) VALUES (
      'hermes-1', 'cli', 'test-model', 'Test session', NULL, 1785114000, 1785114060
    );
    INSERT INTO messages (session_id, role, content, tool_name, timestamp, reasoning)
      VALUES
      ('hermes-1', 'user', 'Hermes user question', NULL, 1785114001, NULL),
      ('hermes-1', 'tool', 'tool output should be excluded', 'terminal', 1785114002, NULL),
      ('hermes-1', 'assistant', 'Hermes final answer', NULL, 1785114003, 'private reasoning');
  `)
  database.close()
}

async function findJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}
