import fs from 'fs'
import { randomUUID } from 'crypto'

/**
 * Writing an index file that more than one process uses (the server, and
 * tools such as bin/enrich.js --reembed): a short lock around each save,
 * judged stale by age rather than process id (so it works across Docker
 * containers), and writes that replace a file whole or not at all.
 */

export const LOCK_STALE_MS = 2 * 60 * 1000 // a save takes seconds; a lock this old was left by a crash
const WAIT_MS = 200

export async function withFileLock (lockPath, fn, { timeoutMs = 60000, now = () => Date.now() } = {}) {
  const started = now()
  for (;;) {
    try {
      await fs.promises.writeFile(lockPath, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const age = now() - (await fs.promises.stat(lockPath).then(s => s.mtimeMs, () => now()))
      if (age > LOCK_STALE_MS) {
        await fs.promises.rm(lockPath, { force: true })
        continue
      }
      if (now() - started > timeoutMs) throw new Error(`${lockPath} is held by another process; try again`)
      await new Promise(resolve => setTimeout(resolve, WAIT_MS))
    }
  }
  try {
    return await fn()
  } finally {
    await fs.promises.rm(lockPath, { force: true })
  }
}

/** Write to a temporary file, then rename over the target. */
export async function writeWhole (file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.promises.writeFile(tmp, data)
  await fs.promises.rename(tmp, file)
}

/** The id of the last save recorded in a sidecar (null if none). */
export async function savedWriteId (sidecarPath) {
  try {
    return JSON.parse(await fs.promises.readFile(sidecarPath, 'utf8')).writeId ?? null
  } catch {
    return null
  }
}

export const newWriteId = () => randomUUID()
