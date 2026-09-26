#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import LinkStore from '../src/common/links/LinkStore.js'
import { parseTurtleFile } from '../src/common/rdf/TurtleReader.js'
import WikiStore from '../src/wiki/WikiStore.js'
import { mentionSync } from '../src/wiki/mentionSync.js'
import { pagesFromDataset, pagesFromMarkdownFiles } from '../src/wiki/importPages.js'
import { slugForTitle } from '../src/wiki/rdf.js'

/**
 * Import wiki pages.
 *
 *   node bin/wiki-import.js --turtle foowiki-dump.ttl   a foowiki store dump
 *   node bin/wiki-import.js --dir notes/                every *.md file in a folder
 *   add --dry-run to list what would change without writing
 *
 * A page whose title matches an existing page becomes a new revision of it
 * (only if the text differs), so re-running an import is safe and web
 * edits stay in the history. Links between imported pages become
 * [[Title]] links and mentions. Restart the server afterwards: it caches
 * pages in memory.
 */

logger.setLevel('warn')

const args = process.argv.slice(2)
const option = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const turtle = option('--turtle')
const dir = option('--dir')
const dryRun = args.includes('--dry-run')
if (!turtle === !dir) {
  console.error('Usage: node bin/wiki-import.js (--turtle <file.ttl> | --dir <folder>) [--dry-run]')
  process.exit(1)
}

let pages
if (turtle) {
  pages = pagesFromDataset(await parseTurtleFile(turtle))
} else {
  const names = (await fs.promises.readdir(dir)).filter(n => n.toLowerCase().endsWith('.md')).sort()
  pages = pagesFromMarkdownFiles(await Promise.all(names.map(async name => ({ name, text: await fs.promises.readFile(path.join(dir, name), 'utf8') }))))
}
if (!pages.length) {
  console.error(`No pages found in ${turtle ?? dir}.`)
  process.exit(1)
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
const links = new LinkStore({ client, repository })
const store = new WikiStore({ client, repository, links })
const mentions = mentionSync({ store, links })

const counts = { created: 0, revised: 0, unchanged: 0, failed: 0 }
const saved = []
for (const page of pages) {
  const current = await store.byTitle(page.title)
  const same = current && current.content === page.content && (!page.tags.length || [...current.tags].sort().join() === [...page.tags].map(t => t.toLowerCase()).sort().join())
  const status = !current ? 'created' : same ? 'unchanged' : 'revised'
  if (dryRun || status === 'unchanged') {
    counts[status]++
    console.log(`  ${status.padEnd(9)} ${page.title}`)
    continue
  }
  try {
    saved.push(await store.save({
      slug: current?.slug ?? slugForTitle(page.title),
      title: page.title,
      content: page.content,
      tags: page.tags.length ? page.tags : undefined,
      baseRevision: current?.revision ?? 0,
      created: page.created,
      actor: 'import'
    }))
    counts[status]++
    console.log(`  ${status.padEnd(9)} ${page.title}`)
  } catch (error) {
    counts.failed++
    console.error(`  failed    ${page.title}: ${error.message}${error.violations ? ` (${error.violations.join('; ')})` : ''}`)
  }
}

let mentioned = 0
for (const page of saved) mentioned += (await mentions.sync(page, 'import')).length

console.log(`${dryRun ? 'Would import' : 'Imported'} ${pages.length} pages from ${turtle ?? dir}: ${JSON.stringify(counts)}`)
if (!dryRun) console.log(`  ${mentioned} mentions linked. Restart the server to see them at /wiki/`)
