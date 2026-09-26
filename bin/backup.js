#!/usr/bin/env node
import path from 'path'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import { backup } from '../src/common/ops/backup.js'

/**
 * Back up the store (all graphs, TriG, gzipped) and the vector index.
 *
 *   node bin/backup.js [--dir data/backups] [--keep 14] [--with-cache]
 *
 * Schedule it with cron (docs/deployment.md). Restore with bin/restore.js.
 */

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const config = Config.load()
const endpoint = config.get('storage.endpoint')
const client = new SPARQLClient(endpoint)
const root = path.resolve(Config.projectRoot, option('--dir', process.env.BACKUP_DIR || 'data/backups'))
const started = Date.now()
const { dir, manifest, removed } = await backup({
  dataUrl: `${endpoint.urlBase}/${endpoint.dataset}/data`,
  authHeader: client.authHeader,
  root,
  keep: Number(option('--keep', 14)),
  files: {
    index: path.resolve(Config.projectRoot, config.get('index.path')),
    cache: args.includes('--with-cache') ? path.resolve(Config.projectRoot, 'data/cache') : null
  }
})
console.log(`Backed up to ${dir} in ${((Date.now() - started) / 1000).toFixed(1)}s: store ${(manifest.storeBytes / 1e6).toFixed(1)} MB${manifest.files.index ? ', index' : ''}${manifest.files.cache ? ', caches' : ''}`)
for (const old of removed) console.log(`  removed old backup ${path.basename(old)}`)
