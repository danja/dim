#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import GraphWriter from '../src/common/store/GraphWriter.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import LinkStore from '../src/common/links/LinkStore.js'
import URIMinter from '../src/common/rdf/URIMinter.js'
import { NAMESPACES } from '../src/common/rdf/NamespaceManager.js'
import { iri } from '../src/common/store/SPARQLHelper.js'
import OutlineStore from '../src/trestle/OutlineStore.js'
import { planImport } from '../src/trestle/importOutline.js'
import { outlineIri, outlineTriples, nodeTriples } from '../src/trestle/rdf.js'

/**
 * Import a Markdown outline (Workflowy export) into Trestle.
 *
 *   node bin/trestle-import.js [--file data/workflowy.md] [--slug workflowy] [--title Workflowy] [--replace]
 *
 * Each item becomes a node in graph:facet/trestle; items that link to a
 * bookmark already in the store get a dim:resource link to it, so the
 * bookmark is one click away in the outline. Refuses to touch an existing
 * outline unless --replace, which deletes that outline (and its nodes'
 * links) first — edits made in the web UI to that outline are lost.
 * Restart the server afterwards: it caches outlines in memory.
 */

logger.setLevel('warn')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const replace = args.includes('--replace')
const config = Config.load()
const file = option('--file', config.get('sources.workflowy.file'))
const slug = option('--slug', 'workflowy')
const title = option('--title', 'Workflowy')

const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
const validator = await ShapeValidator.load()
const repository = new Repository({ client, validator, changeLog: new ChangeLog({ client, registry }), registry })
const links = new LinkStore({ client, repository })
const store = new OutlineStore({ client, repository, links })
const writer = new GraphWriter(client, { registry })

const existing = await store.outline(slug)
if (existing && !replace) {
  console.error(`Outline "${slug}" already exists (${existing.nodes.size} nodes). Use --replace to delete and re-import it — web edits to it will be lost.`)
  process.exit(1)
}
if (existing) {
  const iris = [...existing.nodes.values()].map(n => n.iri)
  await repository.deleteResources({ graph: await store.graph(), subjects: [...iris, existing.iri], actor: 'import', summary: `replacing outline ${slug}` })
  await links.forget(iris)
  console.log(`Deleted outline "${slug}" (${iris.length} nodes) for re-import.`)
}

const started = Date.now()
const markdown = await fs.promises.readFile(path.isAbsolute(file) ? file : path.join(Config.projectRoot, file), 'utf8')
const outline = outlineIri(slug)
const { nodes } = planImport(markdown, { outline })

const bookmarkRows = await client.select(`SELECT DISTINCT ?b WHERE { GRAPH ?g { ?b a ${iri(NAMESPACES.dim + 'Bookmark')} } }`)
const bookmarks = new Set(bookmarkRows.map(r => r.b))
const minter = new URIMinter()
const groups = [outlineTriples({ iri: outline, title, created: new Date() })]
const linkGroups = []
let linked = 0
for (const node of nodes) {
  groups.push(nodeTriples(node))
  const targets = new Set()
  for (const url of node.urls) {
    try {
      const b = minter.mintBookmark({ url })
      if (bookmarks.has(b)) targets.add(b)
    } catch { /* not an http(s) URL */ }
  }
  if (targets.size) {
    linkGroups.push([...targets].map(b => `${iri(node.iri)} ${iri(NAMESPACES.dim + 'resource')} ${iri(b)} .`))
    linked += targets.size
  }
}

const report = await validator.validateTriples(groups.flat())
if (!report.conforms) {
  console.error(`The import does not conform: ${report.results[0].message} at ${report.results[0].focusNode}`)
  process.exit(1)
}

const graph = await store.graph()
const written = await writer.writeGrouped(graph, groups)
const linkTriples = linkGroups.length ? await writer.writeGrouped(await links.graph(), linkGroups) : 0
await repository.changeLog.record({ actor: 'import', action: 'add', graph, subject: outline, predicates: [], summary: `imported ${nodes.length} nodes from ${path.basename(file)}` })

const top = nodes.filter(n => n.parent === outline).length
console.log(`Imported "${title}" → ${outline}`)
console.log(`  ${nodes.length} nodes (${top} top level), ${written} triples in ${graph}`)
console.log(`  ${linked} links to bookmarks (${linkTriples} triples) in ${await links.graph()}`)
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s. Restart the server to see it at /trestle/outline/${slug}`)
