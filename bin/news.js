#!/usr/bin/env node
import fs from 'fs'
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import LinkStore from '../src/common/links/LinkStore.js'
import NewsStore from '../src/news/NewsStore.js'
import Poller from '../src/news/Poller.js'
import { resolveFeed } from '../src/news/subscribe.js'
import { parseSubscriptions, toOpml } from '../src/news/formats/opml.js'
import { absoluteUrl } from '../src/news/formats/feed.js'
import { NEWS_CONFIG } from '../config/preferences.js'

/**
 * News from the command line (docs/commands-news.md).
 *
 *   node bin/news.js add <url> [--tags a,b]     subscribe (finds the feed of a web page)
 *   node bin/news.js import <file>              OPML, or a text file of URLs
 *   node bin/news.js export > feeds.opml
 *   node bin/news.js list                       subscriptions and their status
 *   node bin/news.js poll [--all] [--feed <slug>] [--limit N] [--quiet]
 *   node bin/news.js poll --all --refetch        whole feeds, even if unchanged (fills in missing item dates)
 *   node bin/news.js poll --all --include-failing   failing feeds too (they are set aside otherwise)
 *   node bin/news.js park <slug> | unpark <slug>    set a feed aside / return it to reading
 *   node bin/news.js prune [--days 90]          delete old unstarred items
 *   node bin/news.js remove <slug>
 *
 * Restart the server afterwards to see changes made here (it caches news
 * in memory), or poll from the web UI / NEWS_POLL_MINUTES instead.
 */

logger.setLevel('warn')

const [command, ...rest] = process.argv.slice(2)
const option = (name, fallback = null) => {
  const i = rest.indexOf(name)
  return i === -1 ? fallback : rest[i + 1]
}
const TAKES_VALUE = new Set(['--tags', '--feed', '--limit', '--days'])
const positional = rest.filter((a, i) => !a.startsWith('--') && !TAKES_VALUE.has(rest[i - 1]))
const usage = () => {
  console.error('Usage: node bin/news.js add <url> [--tags a,b] | import <file> | export | list | poll [--all] [--refetch] [--feed slug] [--limit N] [--quiet] | park <slug> | unpark <slug> | prune [--days N] | remove <slug>')
  process.exit(1)
}
if (!command) usage()

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
const store = new NewsStore({ client, repository, links: new LinkStore({ client, repository }) })
const poller = new Poller({ store })

switch (command) {
  case 'add': {
    if (!positional[0]) usage()
    const found = await resolveFeed(positional[0])
    if (await store.feedByUrl(found.url)) {
      console.log(`Already subscribed to ${found.url}`)
      break
    }
    const feed = await store.addFeed({ ...found, tags: option('--tags', '') }, 'cli')
    const result = await poller.pollFeed(feed)
    console.log(`Subscribed to "${feed.title}" (${feed.format}) → ${feed.slug}: ${result.status}, ${result.fresh} items${result.error ? ` (${result.error})` : ''}`)
    for (const alt of found.alternatives) console.log(`  also offered: ${alt.url}${alt.title ? ` (${alt.title})` : ''}`)
    break
  }
  case 'import': {
    if (!positional[0]) usage()
    const entries = parseSubscriptions(await fs.promises.readFile(positional[0], 'utf8'))
    let added = 0
    for (const e of entries) {
      const url = absoluteUrl(e.url, null)
      if (!url || await store.feedByUrl(url)) continue
      await store.addFeed({ url, title: e.title || url, tags: e.tags }, 'cli')
      added++
    }
    console.log(`Imported ${added} new feeds (${entries.length} in the file). Run \`node bin/news.js poll\` to fetch them.`)
    break
  }
  case 'export':
    process.stdout.write(toOpml(await store.feedList()))
    break
  case 'list': {
    const counts = await store.counts()
    for (const f of await store.feedList()) {
      const c = counts.get(f.iri) ?? { total: 0, unread: 0 }
      console.log(`${(f.parked ? `${f.status}*` : f.status).padEnd(12)} ${String(c.unread).padStart(4)}/${String(c.total).padEnd(4)} ${f.slug.padEnd(40)} ${f.title}${f.lastError ? `  — ${f.lastError}` : ''}`)
    }
    console.log('(* failing: set aside, not polled; see /news/admin or `park`/`unpark`)')
    break
  }
  case 'poll': {
    const slug = option('--feed')
    const feeds = slug ? [await store.feed(slug)].filter(Boolean) : rest.includes('--include-failing') ? await store.feedList() : null
    if (slug && !feeds.length) { console.error(`No feed ${slug}`); process.exit(1) }
    const quiet = rest.includes('--quiet')
    const started = Date.now()
    const totals = await poller.pollDue({
      feeds,
      force: rest.includes('--all') || Boolean(slug),
      refetch: rest.includes('--refetch'),
      limit: Number(option('--limit', Infinity)),
      onResult: quiet ? null : (feed, r) => console.log(`  ${r.status.padEnd(12)} ${String(r.fresh).padStart(3)} new  ${feed.title}${r.error ? `  — ${r.error}` : ''}`)
    })
    console.log(`Polled ${totals.polled} feeds in ${((Date.now() - started) / 1000).toFixed(1)}s: ${totals.fresh} new items; ok ${totals.ok}, unchanged ${totals['not-modified']}, errors ${totals.error}, refused ${totals.refused}, gone ${totals.gone}${totals.parked ? `; set aside as failing: ${totals.parked}` : ''}`)
    break
  }
  case 'prune': {
    const days = Number(option('--days', NEWS_CONFIG.retentionDays))
    console.log(`Pruned ${await store.prune({ days })} items first seen over ${days} days ago (starred kept).`)
    break
  }
  case 'park':
  case 'unpark': {
    const feed = await store.feed(positional[0] ?? '')
    if (!feed) { console.error(`No feed ${positional[0]}`); process.exit(1) }
    await store.setParked(feed, command === 'park')
    console.log(`${command === 'park' ? 'Set aside' : 'Returned to reading'}: ${feed.title}`)
    break
  }
  case 'remove': {
    const feed = await store.feed(positional[0] ?? '')
    if (!feed) { console.error(`No feed ${positional[0]}`); process.exit(1) }
    console.log(`Unsubscribed from "${feed.title}"; deleted ${await store.deleteFeed(feed, 'cli')} items.`)
    break
  }
  default:
    usage()
}
