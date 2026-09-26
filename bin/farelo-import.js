#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import LinkStore from '../src/common/links/LinkStore.js'
import OutlineStore from '../src/trestle/OutlineStore.js'
import TaskStore from '../src/farelo/TaskStore.js'
import { childrenOf } from '../src/trestle/tree.js'
import { planTasks } from '../src/farelo/fromOutline.js'
import { plainText } from '../src/common/outline/OutlineParser.js'
import { NAMESPACES } from '../src/common/rdf/NamespaceManager.js'

/**
 * Seed Farelo tasks from a Trestle outline's TODO sections.
 *
 *   node bin/farelo-import.js [--outline workflowy] [--status backlog|todo] [--dry-run]
 *
 * Each task links to its outline item (dim:resource), so the context is one
 * click away and the item shows the task under "Used by". Items already
 * linked from a task are skipped, and a to-do whose title matches an
 * existing task is linked to it rather than duplicated — so re-running,
 * even after trestle-import --replace, only adds what is new.
 * Tasks start in Backlog by default: old to-dos are candidates, not
 * commitments, and the dice only draw from To do and Doing.
 * Restart the server afterwards (tasks are cached in memory).
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1] }
const slug = option('--outline', 'workflowy')
const status = option('--status', 'backlog')
const dryRun = args.includes('--dry-run')
if (!['backlog', 'todo'].includes(status)) {
  console.error('--status must be backlog or todo')
  process.exit(2)
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
const outlines = new OutlineStore({ client, repository, links })
const tasks = new TaskStore({ client, repository, links })

const outline = await outlines.outline(slug)
if (!outline) {
  console.error(`No outline "${slug}". Import one first: node bin/trestle-import.js`)
  process.exit(1)
}

const plan = planTasks(outline, parent => childrenOf(outline, parent))
const linked = await client.select(`SELECT ?node WHERE { GRAPH <${await links.graph()}> { ?task <${NAMESPACES.dim}resource> ?node FILTER(STRSTARTS(STR(?task), "${NAMESPACES.dim}task/")) } }`)
const done = new Set(linked.map(r => r.node))
const todo = plan.filter(p => !done.has(p.node.iri))

console.log(`${plan.length} to-dos in "${outline.title}", ${plan.length - todo.length} already imported, ${todo.length} to add as ${status}.`)
if (dryRun) {
  for (const p of todo) console.log(`${p.isProject ? 'P' : ' '} ${p.project ? '  ' : ''}${plainText(p.title).slice(0, 90)}`)
  process.exit(0)
}

const projectIds = new Map() // outline node iri → task id
const byTitle = new Map((await tasks.list()).map(t => [t.title, t]))
let n = 0
let relinked = 0
for (const p of todo) {
  // Same title as an existing task (e.g. after trestle-import --replace made
  // new items): link the task to the new item instead of duplicating it.
  const existing = byTitle.get(plainText(p.title).slice(0, 500))
  if (existing) {
    await links.add({ from: existing.iri, kind: 'resource', to: p.node.iri, actor: 'import' })
    if (p.isProject) projectIds.set(p.node.iri, existing.id)
    relinked++
    continue
  }
  const fields = { title: plainText(p.title).slice(0, 500), status, isProject: p.isProject }
  const parent = p.project && (projectIds.get(p.project.iri) ?? (await tasks.list()).find(t => t.title === plainText(p.project.title))?.id)
  if (parent) fields.project = parent
  const task = await tasks.create(fields, 'import')
  await links.add({ from: task.iri, kind: 'resource', to: p.node.iri, actor: 'import' })
  if (p.isProject) projectIds.set(p.node.iri, task.id)
  if (++n % 25 === 0) console.log(`  ${n}/${todo.length}`)
}
console.log(`Added ${n} tasks, relinked ${relinked} existing ones. Restart the server to see them at /farelo/`)
