import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'

import yaml from 'js-yaml'

import { brainPaths } from '../src/cli/brain-config.ts'
import { maintainBrain } from '../src/cli/brain-maintain.ts'
import { captureBrainEvent, initBrain } from '../src/cli/brain.ts'

describe('brain maintenance worker', () => {
  it('materializes observations while governance has no configured provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-none-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      payload: { summary: 'Use deterministic jobs.' },
      idFactory: () => 'pending-event',
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    const result = await maintainBrain({ homeDir })
    assert.deepEqual(result, {
      processed: 0,
      observed: 1,
      resolved: 0,
      pending: 1,
    })
    assert.match(
      await readFile(
        join(
          repoPath,
          'observations/device-a/2026/07',
          'observation_fda11b94d57fb3cf0d191a4d.json',
        ),
        'utf8',
      ),
      /Use deterministic jobs/,
    )
  })

  it('accepts structured command-provider output and removes completed jobs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-command-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    const providerPath = join(root, 'provider.mjs')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      providerPath,
      `process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    model: "fixture-model",
    prompt_version: "v1",
    confidence: 0.95,
    operations: [{
      op: "ADD_CLAIM",
      claim: {
        id: "claim-provider",
        title: "Provider claim",
        body: "The provider emitted a structured claim.",
        classification: "private",
        scopes: ["personal"],
        authority: "model",
        confidence: 0.95
      }
    }]
  }));
});
`,
    )
    await chmod(providerPath, 0o700)
    await configureProvider(homeDir, [process.execPath, providerPath])
    await captureBrainEvent({
      homeDir,
      agent: 'hermes',
      eventType: 'post-llm-call',
      payload: { summary: 'A governed source.' },
      idFactory: () => 'provider-event',
      now: new Date('2026-07-27T00:00:00.000Z'),
    })

    const result = await maintainBrain({ homeDir })
    assert.deepEqual(result, {
      processed: 1,
      observed: 1,
      resolved: 1,
      pending: 0,
    })
    assert.match(
      await readFile(join(repoPath, 'claims/claim-provider.md'), 'utf8'),
      /structured claim/,
    )
  })

  it('rejects malformed or failing provider responses without deleting the job', async () => {
    const cases = [
      {
        name: 'invalid-json',
        body: 'process.stdout.write("not-json")',
        error: /invalid JSON/,
      },
      {
        name: 'non-object',
        body: 'process.stdout.write("[]")',
        error: /must be an object/,
      },
      {
        name: 'missing-operations',
        body: 'process.stdout.write(JSON.stringify({model:"x",confidence:1}))',
        error: /operations must be an array/,
      },
      {
        name: 'missing-model',
        body: 'process.stdout.write(JSON.stringify({operations:[],confidence:1}))',
        error: /compiler\.model/,
      },
      {
        name: 'bad-confidence',
        body: 'process.stdout.write(JSON.stringify({operations:[],model:"x",confidence:"high"}))',
        error: /compiler\.confidence must be a number/,
      },
      {
        name: 'failure',
        body: 'process.stderr.write("broken"); process.exit(7)',
        error: /exited 7: broken/,
      },
      {
        name: 'oversized',
        body: 'process.stdout.write("x".repeat(11 * 1024 * 1024))',
        error: /output exceeds/,
      },
    ]
    for (const item of cases) {
      const root = await mkdtemp(join(tmpdir(), `deweyou-brain-${item.name}-`))
      const homeDir = join(root, 'home')
      const repoPath = join(root, 'knowledge')
      const providerPath = join(root, 'provider.mjs')
      await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
      await writeFile(providerPath, item.body)
      await configureProvider(homeDir, [process.execPath, providerPath])
      await captureBrainEvent({
        homeDir,
        agent: 'codex',
        eventType: 'stop',
        payload: { summary: 'Provider failure fixture.' },
        idFactory: () => item.name,
      })

      await assert.rejects(maintainBrain({ homeDir }), item.error)
      const queue = await readdir(brainPaths(homeDir).queueRoot)
      assert.equal(queue.length, 1)
    }
  })

  it('skips unrelated queue entries and handles missing provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deweyou-brain-maintain-edge-'))
    const homeDir = join(root, 'home')
    const repoPath = join(root, 'knowledge')
    await initBrain({ homeDir, repoPath, deviceId: 'device-a' })
    await writeFile(
      join(brainPaths(homeDir).queueRoot, 'ignored.json'),
      '{"kind":"other"}\n',
    )
    assert.deepEqual(await maintainBrain({ homeDir }), {
      processed: 0,
      observed: 0,
      resolved: 0,
      pending: 0,
    })
    await rm(brainPaths(homeDir).queueRoot, { recursive: true })
    assert.deepEqual(await maintainBrain({ homeDir }), {
      processed: 0,
      observed: 0,
      resolved: 0,
      pending: 0,
    })

    await captureBrainEvent({
      homeDir,
      agent: 'codex',
      eventType: 'stop',
      idFactory: () => 'missing-command',
    })
    await configureProvider(homeDir, [])
    await assert.rejects(maintainBrain({ homeDir }), /requires compiler\.command/)
    await configureProvider(homeDir, [join(root, 'does-not-exist')])
    await assert.rejects(maintainBrain({ homeDir }), /ENOENT/)
  })
})

async function configureProvider(homeDir: string, command: string[]): Promise<void> {
  const path = brainPaths(homeDir).configPath
  const config = yaml.load(await readFile(path, 'utf8')) as {
    compiler: { provider: string; command: string[] }
  }
  config.compiler.provider = 'command'
  config.compiler.command = command
  await writeFile(path, yaml.dump(config))
}
