#!/usr/bin/env node
import path from 'path'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import { backup, restore, readManifest, listBackups } from '../src/common/ops/backup.js'

/**
 * Restore a backup made by bin/backup.js. REPLACES the whole store.
 *
 *   node bin/restore.js --list
 *   node bin/restore.js <backup dir> --yes [--store-only] [--with-cache] [--no-safety-backup]
 *
 * First takes a backup of the current state ("pre-restore"), unless told
 * not to. Restart the server afterwards.
 */

const args = process.argv.slice(2)
const config = Config.load()
const endpoint = config.get('storage.endpoint')
const client = new SPARQLClient(endpoint)
const root = path.resolve(Config.projectRoot, process.env.BACKUP_DIR || 'data/backups')
const dataUrl = `${endpoint.urlBase}/${endpoint.dataset}/data`
const files = { index: path.resolve(Config.projectRoot, config.get('index.path')), cache: path.resolve(Config.projectRoot, 'data/cache') }

if (args.includes('--list')) {
  for (const dir of listBackups(root)) {
    const m = readManifest(dir)
    console.log(`${path.basename(dir)}  ${(m.storeBytes / 1e6).toFixed(1)} MB  ${Object.keys(m.files).join(', ')}`)
  }
  process.exit(0)
}

const target = args.find(a => !a.startsWith('--'))
if (!target) {
  console.error('Usage: node bin/restore.js <backup dir> --yes [--store-only] [--with-cache] [--no-safety-backup]   (or --list)')
  process.exit(1)
}
const dir = path.resolve(target.includes('/') ? target : path.join(root, target))
const manifest = readManifest(dir)
if (!args.includes('--yes')) {
  console.log(`Would REPLACE the store at ${dataUrl} with ${path.basename(dir)} (made ${manifest.createdAt}, ${(manifest.storeBytes / 1e6).toFixed(1)} MB)${!args.includes('--store-only') && manifest.files.index ? ', and the vector index' : ''}${args.includes('--with-cache') && manifest.files.cache ? ' and caches' : ''}.`)
  console.log('Add --yes to do it.')
  process.exit(1)
}
if (!args.includes('--no-safety-backup')) {
  const safety = await backup({ dataUrl, authHeader: client.authHeader, root, files: { index: files.index }, keep: Infinity, label: 'pre-restore' })
  console.log(`Current state saved first: ${safety.dir}`)
}
const { restored } = await restore({ dir, dataUrl, authHeader: client.authHeader, files, withCache: args.includes('--with-cache'), storeOnly: args.includes('--store-only') })
console.log(`Restored ${restored.join(', ')} from ${path.basename(dir)}. Restart the server.`)
