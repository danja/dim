#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import { parseBrowserBookmarks } from '../src/gnamgnam/harvest/BrowserBookmarks.js'
import { saveBookmark } from '../src/gnamgnam/saveBookmark.js'

/**
 * Import bookmarks from a browser's HTML export (Chrome, Edge, Firefox,
 * Safari: Bookmark manager → Export).
 *
 *   node bin/bookmarks-import.js <file.html> [--dry-run] [--no-folder-tags]
 *
 * Saved to graph:facet/gnamgnam like any bookmark made in DIM, so a later
 * `ingest` keeps them. Folders become tags. A URL already bookmarked is
 * skipped, so re-running only adds what is new. Restart the server afterwards
 * (bookmarks are cached in memory); `enrich` fills in the summaries.
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const folderTags = !args.includes('--no-folder-tags')
if (!file) {
  console.error('Usage: node bin/bookmarks-import.js <file.html> [--dry-run] [--no-folder-tags]')
  process.exit(2)
}

const marks = parseBrowserBookmarks(await readFile(file, 'utf8'))
console.log(`${marks.length} bookmarks in ${file}.`)
if (dryRun) {
  for (const m of marks) console.log(`${m.tags.length ? `[${m.tags.join(', ')}] ` : ''}${m.title ?? ''} <${m.url}>`)
  process.exit(0)
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })

let added = 0
let skipped = 0
for (const m of marks) {
  const saved = await saveBookmark({ url: m.url, title: m.title, tags: folderTags ? m.tags : [], context: 'Imported from a browser', client, repository, actor: 'import' })
  if (saved.created) added++
  else skipped++
  if ((added + skipped) % 100 === 0) console.log(`  ${added + skipped}/${marks.length}`)
}
console.log(`Added ${added} bookmarks, skipped ${skipped} already saved. Restart the server to see them.`)
