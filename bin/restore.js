#!/usr/bin/env node
import path from 'path'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import QueryService from '../src/common/store/QueryService.js'
import { backup, restore, restoreGraphs, readManifest, readStore, listBackups, latestBackup } from '../src/common/ops/backup.js'
import { graphCounts, compareCounts, matchGraphs } from '../src/common/ops/backupGraphs.js'
import { backupPaths } from '../src/common/ops/backupPaths.js'

/**
 * Check or restore a backup made by bin/backup.js.
 *
 *   node bin/restore.js --list
 *   (latest = the newest regular backup, not a pre-restore safety copy)
 *   node bin/restore.js <backup|latest> --check            read it, compare with the store; changes nothing
 *   node bin/restore.js <backup|latest> --graph wiki --yes  put back only these graphs (repeat --graph)
 *   node bin/restore.js <backup|latest> --yes [--store-only] [--with-cache]   REPLACE the whole store
 *
 * Restores first take a backup of the current state ("pre-restore") unless
 * --no-safety-backup. Restart the server afterwards.
 */

const args = process.argv.slice(2)
const config = Config.load()
const endpoint = config.get('storage.endpoint')
const client = new SPARQLClient(endpoint)
const paths = backupPaths(config, Config.projectRoot)
const dataUrl = `${endpoint.urlBase}/${endpoint.dataset}/data`
const auth = { dataUrl, authHeader: client.authHeader }
const age = createdAt => {
  const hours = (Date.now() - new Date(createdAt)) / 36e5
  return hours < 48 ? `${hours.toFixed(1)} h ago` : `${Math.round(hours / 24)} days ago`
}
const fail = message => {
  console.error(message)
  process.exit(1)
}

if (args.includes('--list')) {
  for (const dir of listBackups(paths.root)) {
    const m = readManifest(dir)
    console.log(`${path.basename(dir)}  ${age(m.createdAt).padEnd(12)} ${(m.storeBytes / 1e6).toFixed(1)} MB  ${[...(m.files.data ?? []), ...(m.files.index ? ['index'] : []), ...(m.files.cache ? ['cache'] : [])].join(', ')}`)
  }
  process.exit(0)
}

const graphNames = args.flatMap((a, i) => a === '--graph' ? [args[i + 1]] : [])
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--graph')
if (!target) fail('Usage: node bin/restore.js <backup|latest> [--check | --graph <name>… --yes | --yes]   (or --list)')
const dir = target === 'latest' ? latestBackup(paths.root)?.dir : path.resolve(target.includes('/') ? target : path.join(paths.root, target))
if (!dir) fail(`No backups in ${paths.root}`)
let manifest
try {
  manifest = readManifest(dir)
} catch (error) {
  fail(error.message)
}
const name = `${path.basename(dir)} (made ${manifest.createdAt}, ${age(manifest.createdAt)})`

if (args.includes('--check')) {
  let counts
  try {
    counts = await graphCounts(await readStore(dir, manifest))
  } catch (error) {
    fail(`${name}: NOT OK — ${error.message}`)
  }
  if (!counts.size) fail(`${name}: NOT OK — the store file holds no triples`)
  const rows = await client.select(new QueryService().get('graph/counts')).catch(() => null)
  const live = rows && new Map(rows.map(r => [r.g, Number(r.n)]))
  const table = compareCounts(counts, live)
  const width = Math.max(...table.map(r => r.graph.length))
  console.log(`${name}: checksum ok, ${table.length} graphs, ${[...counts.values()].reduce((a, b) => a + b, 0)} triples${live ? '' : ' (store not reachable: no comparison)'}`)
  for (const r of table) console.log(`  ${r.graph.padEnd(width)}  ${String(r.backup).padStart(8)}${live ? `  ${String(r.live).padStart(8)} now${r.live === r.backup ? '' : `  (${r.live > r.backup ? '+' : ''}${r.live - r.backup})`}` : ''}`)
  console.log(`  data files: ${(manifest.files.data ?? (manifest.files.index ? ['bookmark index'] : [])).join(', ') || 'none'}${manifest.files.cache ? '; caches' : ''}`)
  process.exit(0)
}

let graphs = []
if (graphNames.length) {
  const inBackup = [...(await graphCounts(await readStore(dir, manifest))).keys()]
  for (const g of graphNames) {
    const found = matchGraphs(g, inBackup)
    if (!found.length) fail(`No graph "${g}" in ${path.basename(dir)}. It holds: ${inBackup.sort().join(', ')}`)
    graphs.push(...found)
  }
  graphs = [...new Set(graphs)]
}

if (!args.includes('--yes')) {
  if (graphs.length) console.log(`Would REPLACE these graphs with their contents in ${name}, leaving the rest of the store as it is:\n  ${graphs.join('\n  ')}`)
  else console.log(`Would REPLACE the whole store at ${dataUrl} with ${name}${!args.includes('--store-only') && (manifest.files.data || manifest.files.index) ? ', and the data files (vector indexes)' : ''}${args.includes('--with-cache') && manifest.files.cache ? ' and caches' : ''}.`)
  console.log('Add --yes to do it.')
  process.exit(1)
}
if (!args.includes('--no-safety-backup')) {
  const safety = await backup({ ...auth, root: paths.root, files: { data: paths.data }, keep: Infinity, label: 'pre-restore' })
  console.log(`Current state saved first: ${safety.dir}`)
}
if (graphs.length) {
  for (const { graph, triples } of await restoreGraphs({ dir, graphs, ...auth })) console.log(`Restored ${graph}: ${triples} triples`)
  console.log('The vector indexes were left as they are. Restart the server.')
} else {
  const { restored } = await restore({ dir, ...auth, dataDir: paths.dataDir, cacheDir: paths.cacheDir, withCache: args.includes('--with-cache'), storeOnly: args.includes('--store-only') })
  console.log(`Restored ${restored.join(', ')} from ${path.basename(dir)}. Restart the server.`)
}
