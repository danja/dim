import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

/**
 * Backups: the whole store as gzipped TriG (every named graph, from the
 * Graph Store endpoint), the vector index, and optionally the harvest
 * caches — into one timestamped directory with a manifest of checksums.
 * Restore puts them back (replacing the store's dataset).
 *
 * dataUrl: the dataset's read-write Graph Store endpoint (…/dim/data).
 */

export const MARKER = 'dim-backup'
const STORE_FILE = 'store.trig.gz'

export function stamp (date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
}

async function sha256 (file) {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

function copyIfThere (from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
  return true
}

/** Directories made by backup(), newest first. */
export function listBackups (root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root)
    .map(name => path.join(root, name))
    .filter(dir => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).tool === MARKER } catch { return false }
    })
    .sort().reverse()
}

/**
 * → { dir, manifest }. files: { index: path (the .index; its .json sidecar
 * comes too), cache: dir or null }. keep: how many backups to keep in root.
 */
export async function backup ({ dataUrl, authHeader = null, root, files = {}, keep = 14, label = '', fetchImpl = fetch, now = new Date() }) {
  const dir = path.join(root, `${stamp(now)}${label ? `-${label}` : ''}`)
  fs.mkdirSync(dir, { recursive: true })

  const response = await fetchImpl(dataUrl, { headers: { Accept: 'application/trig', ...(authHeader ? { Authorization: authHeader } : {}) } })
  if (!response.ok) throw new Error(`The store answered HTTP ${response.status} to ${dataUrl}`)
  const storeFile = path.join(dir, STORE_FILE)
  await pipeline(Readable.fromWeb(response.body), zlib.createGzip(), fs.createWriteStream(storeFile))

  const included = { store: STORE_FILE }
  if (files.index && copyIfThere(files.index, path.join(dir, 'index', path.basename(files.index)))) {
    copyIfThere(`${files.index}.json`, path.join(dir, 'index', `${path.basename(files.index)}.json`))
    included.index = `index/${path.basename(files.index)}`
  }
  if (files.cache && copyIfThere(files.cache, path.join(dir, 'cache'))) included.cache = 'cache'

  const manifest = {
    tool: MARKER,
    createdAt: now.toISOString(),
    source: dataUrl,
    files: included,
    storeBytes: fs.statSync(storeFile).size,
    storeSha256: await sha256(storeFile)
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const removed = []
  for (const old of listBackups(root).slice(keep)) {
    fs.rmSync(old, { recursive: true, force: true })
    removed.push(old)
  }
  return { dir, manifest, removed }
}

export function readManifest (dir) {
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) } catch { manifest = null }
  if (manifest?.tool !== MARKER) throw new Error(`${dir} is not a DIM backup (no manifest.json from bin/backup.js)`)
  return manifest
}

/**
 * Put a backup back. The store's whole dataset is replaced (PUT); the
 * index and caches are copied over the current ones when present and asked
 * for. The checksum is verified first.
 */
export async function restore ({ dir, dataUrl, authHeader = null, files = {}, withCache = false, storeOnly = false, fetchImpl = fetch }) {
  const manifest = readManifest(dir)
  const storeFile = path.join(dir, manifest.files.store)
  if (await sha256(storeFile) !== manifest.storeSha256) throw new Error(`${storeFile} does not match its checksum; not restoring`)
  const trig = zlib.gunzipSync(fs.readFileSync(storeFile))
  const response = await fetchImpl(dataUrl, { method: 'PUT', headers: { 'Content-Type': 'application/trig', ...(authHeader ? { Authorization: authHeader } : {}) }, body: trig })
  if (!response.ok) throw new Error(`The store refused the restore: HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`)

  const restored = ['store']
  if (!storeOnly && manifest.files.index && files.index) {
    const from = path.join(dir, manifest.files.index)
    fs.mkdirSync(path.dirname(files.index), { recursive: true })
    fs.copyFileSync(from, files.index)
    if (fs.existsSync(`${from}.json`)) fs.copyFileSync(`${from}.json`, `${files.index}.json`)
    restored.push('index')
  }
  if (!storeOnly && withCache && manifest.files.cache && files.cache) {
    fs.cpSync(path.join(dir, manifest.files.cache), files.cache, { recursive: true })
    restored.push('cache')
  }
  return { manifest, restored }
}
