#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import LinkStore from '../src/common/links/LinkStore.js'
import { backfillHashtags } from '../src/common/hashtags/backfill.js'
import WikiStore from '../src/wiki/WikiStore.js'
import TaskStore from '../src/farelo/TaskStore.js'
import OutlineStore from '../src/trestle/OutlineStore.js'
import PostStore from '../src/blog/PostStore.js'

/**
 * Read #hashtags from text saved before hashtags existed (wiki pages, tasks,
 * outline nodes, blog posts), and record them as SKOS concepts and
 * dim:hashtag links, as saving does. Safe to repeat.
 *
 *   node bin/hashtags-backfill.js [--dry-run]
 *
 * Bookmark notes are not read (they are not listed outside the search
 * index); they are picked up when next saved. Restart the server afterwards.
 */

logger.setLevel('warn')
const dryRun = process.argv.includes('--dry-run')

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
const links = new LinkStore({ client, repository })
const deps = { client, repository, links }

const items = []
for (const page of await new WikiStore(deps).list()) items.push({ iri: page.iri, texts: [page.content] })
const taskStore = new TaskStore(deps)
for (const task of [...await taskStore.list(), ...await taskStore.listArchived()]) items.push({ iri: task.iri, texts: [task.title, task.note] })
for (const outline of await new OutlineStore(deps).list()) {
  for (const node of outline.nodes.values()) items.push({ iri: node.iri, texts: [node.title, node.note] })
}
for (const post of await new PostStore(deps).list({ drafts: true })) items.push({ iri: post.iri, texts: [post.content] })

const report = await backfillHashtags(items, links, { dryRun, onProgress: n => { if (n % 500 === 0) console.log(`  ${n}/${items.length}`) } })
console.log(`${report.items} items read, ${report.tagged} with hashtags, ${report.tags.size} distinct tags${dryRun ? ' (dry run, nothing written)' : ''}.`)
for (const [tag, n] of [...report.tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20)) console.log(`  #${tag}  ${n}`)
if (!dryRun) console.log('Restart the server to see them at /tags')
