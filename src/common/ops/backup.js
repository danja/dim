import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { graphsAsNTriples } from './backupGraphs.js'

/**
 * Backups: the whole store as gzipped TriG (every named graph, from the
 * Graph Store endpoint), the files under data/ that are slow to rebuild
 * (vector indexes, the related state), and optionally the harvest caches —
 * into one timestamped directory with a manifest and a checksum.
 * Restore puts them back: the whole dataset, or chosen graphs only.
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
 * The newest regular backup in root (labelled ones, like pre-restore safety
 * copies, don't show that scheduled backups still run).
 * → { dir, latest, createdAt, hours } or null
 */
export function latestBackup (root, now = new Date()) {
  const dir = listBackups(root).find(d => /Z$/.test(d))
  if (!dir) return null
  const { createdAt } = readManifest(dir)
  return { dir, latest: path.basename(dir), createdAt, hours: Math.round((now - new Date(createdAt)) / 36e5 * 10) / 10 }
}

/**
 * → { dir, manifest, removed }. files: { data: [paths of files to keep a
 * copy of; missing ones are skipped], cache: dir or null }. keep: how many
 * backups to keep in root.
 */
export async function backup ({ dataUrl, authHeader = null, root, files = {}, keep = 14, label = '', fetchImpl = fetch, now = new Date() }) {
  const dir = path.join(root, `${stamp(now)}${label ? `-${label}` : ''}`)
  fs.mkdirSync(dir, { recursive: true })

  const response = await fetchImpl(dataUrl, { headers: { Accept: 'application/trig', ...(authHeader ? { Authorization: authHeader } : {}) } })
  if (!response.ok) throw new Error(`The store answered HTTP ${response.status} to ${dataUrl}`)
  const storeFile = path.join(dir, STORE_FILE)
  await pipeline(Readable.fromWeb(response.body), zlib.createGzip(), fs.createWriteStream(storeFile))

  const included = { store: STORE_FILE }
  const data = (files.data ?? []).filter(file => copyIfThere(file, path.join(dir, 'data', path.basename(file))))
  if (data.length) included.data = data.map(file => path.basename(file))
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

/** The store file's TriG, after checking it against the manifest. */
export async function readStore (dir, manifest = readManifest(dir)) {
  const storeFile = path.join(dir, manifest.files.store)
  if (await sha256(storeFile) !== manifest.storeSha256) throw new Error(`${storeFile} does not match its checksum; not using it`)
  return zlib.gunzipSync(fs.readFileSync(storeFile))
}

/** Files under data/ a backup holds (older backups kept only the bookmark index). */
function dataFiles (dir, manifest) {
  if (manifest.files.data) return manifest.files.data.map(name => path.join(dir, 'data', name))
  if (!manifest.files.index) return []
  const index = path.join(dir, manifest.files.index)
  return [index, `${index}.json`].filter(file => fs.existsSync(file))
}

/**
 * Put a backup back. The store's whole dataset is replaced (PUT); the data
 * files are copied into dataDir unless storeOnly; the caches too if asked.
 * The checksum is verified first.
 */
export async function restore ({ dir, dataUrl, authHeader = null, dataDir = null, cacheDir = null, withCache = false, storeOnly = false, fetchImpl = fetch }) {
  const manifest = readManifest(dir)
  const trig = await readStore(dir, manifest)
  const response = await fetchImpl(dataUrl, { method: 'PUT', headers: { 'Content-Type': 'application/trig', ...(authHeader ? { Authorization: authHeader } : {}) }, body: trig })
  if (!response.ok) throw new Error(`The store refused the restore: HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`)

  const restored = ['store']
  const data = storeOnly || !dataDir ? [] : dataFiles(dir, manifest)
  if (data.length) {
    fs.mkdirSync(dataDir, { recursive: true })
    for (const file of data) fs.copyFileSync(file, path.join(dataDir, path.basename(file)))
    restored.push(...data.map(file => path.basename(file)))
  }
  if (!storeOnly && withCache && manifest.files.cache && cacheDir) {
    fs.cpSync(path.join(dir, manifest.files.cache), cacheDir, { recursive: true })
    restored.push('cache')
  }
  return { manifest, restored }
}

/**
 * Put back some graphs only, leaving the rest of the store as it is. Each
 * graph is replaced (PUT ?graph=); one the backup doesn't hold is emptied.
 * → [{ graph, triples }]
 */
export async function restoreGraphs ({ dir, graphs, dataUrl, authHeader = null, fetchImpl = fetch }) {
  const byGraph = await graphsAsNTriples(await readStore(dir), graphs)
  const done = []
  for (const [graph, ntriples] of byGraph) {
    const response = await fetchImpl(`${dataUrl}?graph=${encodeURIComponent(graph)}`, { method: 'PUT', headers: { 'Content-Type': 'application/n-triples', ...(authHeader ? { Authorization: authHeader } : {}) }, body: ntriples })
    if (!response.ok) throw new Error(`The store refused ${graph}: HTTP ${response.status}`)
    done.push({ graph, triples: ntriples ? ntriples.split('\n').length - 1 : 0 })
  }
  return done
}
