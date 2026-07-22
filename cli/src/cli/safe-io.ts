import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600

export async function mkdirPrivate(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIRECTORY_MODE })
  await chmod(path, DIRECTORY_MODE)
}

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdirPrivate(dirname(path))
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`

  try {
    await writeFile(temporaryPath, content, {
      encoding: 'utf8',
      mode: FILE_MODE,
      flag: 'wx',
    })
    await chmod(temporaryPath, FILE_MODE)
    await rename(temporaryPath, path)
    await chmod(path, FILE_MODE)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function ensurePrivateFile(path: string, content = ''): Promise<void> {
  await mkdirPrivate(dirname(path))
  try {
    const handle = await open(path, 'wx', FILE_MODE)
    try {
      if (content) await handle.writeFile(content, 'utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error
  }
  await chmod(path, FILE_MODE)
}

export async function appendFileLocked(
  path: string,
  content: string,
  {
    beforeAppend,
    maxBytes = 10 * 1024 * 1024,
  }: {
    beforeAppend?: (current: string) => void | Promise<void>
    maxBytes?: number
  } = {},
): Promise<void> {
  await ensurePrivateFile(path)
  await withFileLock(`${path}.lock`, async () => {
    const current = await stat(path)
    const incoming = Buffer.byteLength(content)
    if (current.size + incoming > maxBytes) {
      throw new Error(`DDev event log would exceed ${maxBytes} bytes: ${path}`)
    }
    if (beforeAppend) await beforeAppend(await readFile(path, 'utf8'))

    const handle = await open(path, 'a', FILE_MODE)
    try {
      await handle.writeFile(content, 'utf8')
    } finally {
      await handle.close()
    }
    await chmod(path, FILE_MODE)
  })
}

export async function readTextLimited(path: string, maxBytes: number): Promise<string> {
  const file = await stat(path)
  if (file.size > maxBytes) throw new Error(`DDev file exceeds ${maxBytes} bytes: ${path}`)
  return readFile(path, 'utf8')
}

async function withFileLock(path: string, callback: () => Promise<void>): Promise<void> {
  await mkdirPrivate(dirname(path))
  let handle

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await open(path, 'wx', FILE_MODE)
      break
    } catch (error) {
      /* v8 ignore next -- lock creation errors other than contention should surface unchanged */
      if (!hasCode(error, 'EEXIST')) throw error
      if (await isStaleLock(path)) {
        await rm(path, { force: true })
        continue
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
  }

  if (!handle) throw new Error(`Timed out waiting for DDev event lock: ${path}`)

  try {
    await callback()
  } finally {
    await handle.close()
    await rm(path, { force: true })
  }
}

async function isStaleLock(path: string): Promise<boolean> {
  try {
    const lock = await stat(path)
    return Date.now() - lock.mtimeMs > 30_000
  } catch (error) {
    /* v8 ignore next -- the lock can disappear here only through an external race */
    if (hasCode(error, 'ENOENT')) return false
    /* v8 ignore next -- unexpected stat errors should surface unchanged */
    throw error
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
