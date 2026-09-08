#!/usr/bin/env node
import Config from '../src/Config.js'
import BookmarkHarvester from '../src/harvest/BookmarkHarvester.js'
import { parseWorkflowyFile, deduplicate } from '../src/harvest/WorkflowyParser.js'

/**
 * First-pass retrieval agent (offline report): parse workflowy.md, classify
 * every link without network access, and print the type distribution.
 * This is the plan.md step "GET on each of the links and first-pass determine
 * the type" — run with --live to actually GET (cached 7 days).
 *
 * Usage: node bin/retrieve.js [--live] [--limit N]
 */

const args = process.argv.slice(2)
const live = args.includes('--live')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx === -1 ? Infinity : Number(args[limitIdx + 1])

const config = Config.load()
const rows = deduplicate(await parseWorkflowyFile(config.get('sources.workflowy.file')))
console.log(`${rows.length} unique URLs in ${config.get('sources.workflowy.file')}\n`)

const harvester = new BookmarkHarvester({
  workflowyFile: config.get('sources.workflowy.file'),
  cachePath: config.get('sources.workflowy.cachePath'),
  fetchLive: live
})

const { bookmarks, rejected } = await harvester.harvest()
const slice = bookmarks.slice(0, limit)

const byType = new Map()
for (const b of bookmarks) {
  for (const t of b.bookmarkTypes) {
    const short = t.replace(/^.*\//, '')
    byType.set(short, (byType.get(short) ?? 0) + 1)
  }
}
console.log('First-pass types:')
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${t}`)
}
console.log(`\n${bookmarks.length} bookmarks, ${rejected.length} rejected${live ? '' : ' (offline classification; --live to GET)'}.`)
if (rejected.length) {
  for (const r of rejected.slice(0, 10)) console.log(`  ✗ ${r.name}: ${r.reason}`)
}
if (limit !== Infinity) {
  console.log('\nSample:')
  for (const b of slice.slice(0, 10)) {
    console.log(`  - [${b.linkText ?? b.title ?? '(no text)'}](${b.url}) → ${b.bookmarkTypes.map(t => t.replace(/^.*\//, '')).join(', ')}${b.httpStatus != null ? ` [${b.httpStatus}]` : ''}`)
  }
}
