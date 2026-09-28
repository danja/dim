#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import { buildApp } from '../src/app.js'
import { scanBookmarks } from '../src/news/scanBookmarks.js'
import { feedsOnPage } from '../src/news/feedsOnPage.js'

/**
 * Look through bookmarked web pages for feeds and put them in the feed
 * inbox (Manage feeds, /news/admin), to subscribe to or dismiss there.
 * New bookmarks are checked as they are saved; this is for the ones you
 * already have.
 *
 *   node bin/feed-scan.js                 every site not yet looked at
 *   node bin/feed-scan.js --limit 200     at most 200 pages this run
 *   node bin/feed-scan.js --dry-run       show what it finds; store nothing
 *   node bin/feed-scan.js --rescan        look again at pages seen before
 *
 * Polite: sites in parallel, one page at a time per site with a pause, at
 * most NEWS_CONFIG.scanPagesPerHost pages per site (stopping at the first
 * with a feed), and sites you already read or have a suggestion from are
 * skipped. Pages looked at are remembered in data/cache/feed-scan.json, so
 * Ctrl-C and run again carries on. The server picks the suggestions up
 * within a minute.
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] }
const limit = option('--limit') ? Number(option('--limit')) : Infinity
const dryRun = args.includes('--dry-run')
const quiet = args.includes('--quiet')

let app
try {
  app = await buildApp({ config: Config.load(), projectRoot: Config.projectRoot, env: { ...process.env, AUTO_ENRICH: '0' } })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const statePath = path.join(Config.projectRoot, 'data/cache/feed-scan.json')
let state
try {
  state = new Map(Object.entries(JSON.parse(fs.readFileSync(statePath, 'utf8')).pages ?? {}))
} catch {
  state = new Map()
}
const save = () => {
  if (dryRun) return
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify({ savedAt: new Date().toISOString(), pages: Object.fromEntries(state) }))
}

// A dry run finds feeds the same way but writes nothing.
const inbox = dryRun
  ? {
      knownHosts: () => app.inbox.knownHosts(),
      async addFromPage ({ html, pageUrl }) {
        const feeds = feedsOnPage(html, pageUrl)
        return { found: feeds.length, added: feeds }
      }
    }
  : app.inbox

const started = Date.now()
let planned = 0
const totals = await scanBookmarks({
  docs: [...app.search.documents.values()],
  inbox,
  state: dryRun ? new Map(state) : state,
  limit,
  rescan: args.includes('--rescan'),
  onPlan: p => {
    planned = p.pages
    console.log(`${p.pages} pages to look at on ${p.sites} sites${Number.isFinite(limit) ? ` (limit ${limit})` : ''}.${dryRun ? ' Dry run: nothing is stored.' : ''}`)
  },
  onResult: (doc, result, t) => {
    for (const f of result.added) console.log(`  + ${f.title ? `${f.title} — ` : ''}${f.url}  (on ${doc.url})`)
    if (!quiet && result.status !== 'ok') console.log(`  · ${result.status}: ${doc.url}`)
    if (t.pages % 25 === 0) {
      const took = (Date.now() - started) / 1000
      console.log(`${t.pages}/${planned} pages, ${t.withFeeds} with feeds, ${t.added} suggested (${Math.round(took)}s; ~${Math.round((planned - t.pages) * took / t.pages)}s left)`)
      save()
    }
  }
})
save()
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s: ${totals.pages} pages, ${totals.withFeeds} with feeds, ${totals.added} ${dryRun ? 'would be ' : ''}suggested, ${totals.errors} errors. See Manage feeds (/news/admin).`)
process.exit(0)
