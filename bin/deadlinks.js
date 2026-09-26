#!/usr/bin/env node
import path from 'path'
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import QueryService from '../src/common/store/QueryService.js'
import { linkStatus, LINK_STATUSES } from '../src/gnamgnam/LinkStatus.js'
import { WaybackClient, buildArchivePatchQuery } from '../src/gnamgnam/deadlinks/Wayback.js'

/**
 * Report bookmarks by link status, and optionally find archived copies.
 *
 *   node bin/deadlinks.js [--status dead|blocked|error|ok|unchecked] [--wayback] [--force] [--limit N] [--json]
 *
 * Status is derived from the last HTTP status seen (src/gnamgnam/LinkStatus.js);
 * default --status dead. --wayback asks the Wayback Machine availability API
 * for each listed bookmark without an archived copy (1 request/s, answers
 * cached in data/cache/wayback.json) and writes schema:archivedAt into the
 * bookmark's graph. Re-run after a re-ingest to restore those from the cache.
 * --force re-asks for bookmarks already cached or archived.
 */

logger.setLevel('warn')

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

const wanted = option('--status', 'dead')
if (!LINK_STATUSES.includes(wanted)) {
  console.error(`--status must be one of ${LINK_STATUSES.join(', ')}; got ${wanted}`)
  process.exit(2)
}
const wayback = flag('--wayback')
const force = flag('--force')
const asJson = flag('--json')
const limit = Number(option('--limit', Infinity))

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const rows = await client.select(new QueryService().get('bookmark/statuses', {}))
const counts = Object.fromEntries(LINK_STATUSES.map(s => [s, 0]))
const listed = []
for (const row of rows) {
  const status = linkStatus(row)
  counts[status] += 1
  if (status === wanted) listed.push({ ...row, status })
}
const selected = listed.slice(0, limit)

if (!wayback) {
  if (asJson) {
    console.log(JSON.stringify({ counts, status: wanted, bookmarks: selected }, null, 2))
  } else {
    console.log(`Link status over ${rows.length} bookmarks: ${JSON.stringify(counts)}\n`)
    for (const row of selected) {
      const code = row.fetchStatus ?? row.httpStatus ?? '-'
      console.log(`${String(code).padStart(3)}  ${row.url}${row.archivedAt ? `\n     archived: ${row.archivedAt}` : ''}`)
    }
    console.log(`\n${selected.length} ${wanted}${selected.length < listed.length ? ` (of ${listed.length})` : ''}.`)
  }
  process.exit(0)
}

const archive = new WaybackClient({ cachePath: path.join(Config.projectRoot, 'data/cache/wayback.json') })
const tally = { archived: 0, restored: 0, none: 0, skipped: 0, failed: 0 }
let n = 0
for (const row of selected) {
  n += 1
  if (row.archivedAt && !force) {
    tally.skipped += 1
    continue
  }
  let found
  try {
    found = await archive.lookup(row.url, { force })
  } catch (error) {
    tally.failed += 1
    console.log(`[${n}/${selected.length}] failed   ${row.url} — ${error.message}`)
    continue
  }
  if (!found.archivedUrl) {
    tally.none += 1
    if (!asJson) console.log(`[${n}/${selected.length}] none     ${row.url}`)
    continue
  }
  await client.update(buildArchivePatchQuery(row.g, row.bookmark, found.archivedUrl))
  tally[found.fromCache ? 'restored' : 'archived'] += 1
  if (!asJson) console.log(`[${n}/${selected.length}] ${found.fromCache ? 'restored' : 'archived'} ${row.url}\n     → ${found.archivedUrl}`)
}
console.log(`\nWayback over ${selected.length} ${wanted} bookmarks: ${JSON.stringify(tally)}`)
