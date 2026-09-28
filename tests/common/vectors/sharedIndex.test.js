import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import VectorIndex from '../../../src/common/vectors/VectorIndex.js'
import { withFileLock, LOCK_STALE_MS } from '../../../src/common/vectors/indexFile.js'

const DIM = 4
const MODEL = 'test'
const v = (...xs) => xs

function place () {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dim-shared-index-')), 'dim.index')
}
const open = p => VectorIndex.open({ dimension: DIM, path: p, model: MODEL })

describe('an index file shared by the server and the tools', () => {
  it('keeps both processes\' changes, whichever saves last', async () => {
    const p = place()
    const server = await open(p)
    server.add('a', v(1, 0, 0, 0))
    await server.save()

    // A tool opens the file, and both carry on.
    const tool = await open(p)
    tool.add('b', v(0, 1, 0, 0))
    tool.add('a', v(0.9, 0.1, 0, 0)) // re-embedded
    server.add('c', v(0, 0, 1, 0)) // a bookmark saved meanwhile
    await tool.save()
    await server.save() // used to overwrite the tool's work

    const onDisk = await open(p)
    expect([...onDisk.positionByIri.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(onDisk.search(v(0.9, 0.1, 0, 0), 1)[0]).toMatchObject({ iri: 'a' })
    expect(onDisk.search(v(1, 0, 0, 0), 1)[0].score).toBeLessThan(0.999) // the tool's vector for a, not the old one
    expect([...server.positionByIri.keys()].sort()).toEqual(['a', 'b', 'c']) // the server has the tool's too

    // Removals carry across the same way.
    tool.remove('c')
    await tool.save()
    server.add('d', v(0, 0, 0, 1))
    await server.save()
    expect([...(await open(p)).positionByIri.keys()].sort()).toEqual(['a', 'b', 'd'])
  })

  it('reloads on refresh when someone else saved, but not over its own unsaved changes', async () => {
    const p = place()
    const server = await open(p)
    const tool = await open(p)
    expect(await server.refresh()).toBe(false)
    tool.add('x', v(1, 0, 0, 0))
    await tool.save()
    const same = server
    expect(await server.refresh()).toBe(true)
    expect(same.has('x')).toBe(true) // the same object: everyone holding it sees the change
    expect(await server.refresh()).toBe(false)

    tool.add('y', v(0, 1, 0, 0))
    await tool.save()
    server.add('z', v(0, 0, 1, 0))
    expect(await server.refresh()).toBe(false) // its own save will merge
    await server.save()
    expect([...server.positionByIri.keys()].sort()).toEqual(['x', 'y', 'z'])
  })

  it('waits for a save in progress, and takes over a lock left by a crash', async () => {
    const lock = `${place()}.lock`
    fs.writeFileSync(lock, 'someone')
    await expect(withFileLock(lock, async () => 'mine', { timeoutMs: 300 })).rejects.toThrow('held by another process')
    const old = (Date.now() - LOCK_STALE_MS - 1000) / 1000
    fs.utimesSync(lock, old, old)
    expect(await withFileLock(lock, async () => 'mine')).toBe('mine')
    expect(fs.existsSync(lock)).toBe(false)
  })
})
