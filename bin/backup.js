#!/usr/bin/env node
import path from 'path'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import { backup } from '../src/common/ops/backup.js'
import { backupPaths } from '../src/common/ops/backupPaths.js'

/**
 * Back up the store (all graphs, TriG, gzipped) and the files under data/
 * that are slow to rebuild (vector indexes, the related state).
 *
 *   node bin/backup.js [--dir data/backups] [--keep 14] [--with-cache]
 *
 * Schedule it with cron, check it with bin/restore.js --check, and copy
 * the backups off this machine (docs/backup.md). Restore with bin/restore.js.
 */

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const config = Config.load()
const endpoint = config.get('storage.endpoint')
const client = new SPARQLClient(endpoint)
const paths = backupPaths(config, Config.projectRoot)
const root = args.includes('--dir') ? path.resolve(Config.projectRoot, option('--dir')) : paths.root
const started = Date.now()
try {
  const { dir, manifest, removed } = await backup({
    dataUrl: `${endpoint.urlBase}/${endpoint.dataset}/data`,
    authHeader: client.authHeader,
    root,
    keep: Number(option('--keep', 14)),
    files: { data: paths.data, cache: args.includes('--with-cache') ? paths.cacheDir : null }
  })
  const extras = [...(manifest.files.data ?? []), ...(manifest.files.cache ? ['caches'] : [])]
  console.log(`Backed up to ${dir} in ${((Date.now() - started) / 1000).toFixed(1)}s: store ${(manifest.storeBytes / 1e6).toFixed(1)} MB${extras.length ? `, ${extras.join(', ')}` : ''}`)
  for (const old of removed) console.log(`  removed old backup ${path.basename(old)}`)
} catch (error) {
  console.error(`Backup failed: ${error.message}`)
  process.exit(1)
}
