#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import { buildApp } from '../src/app.js'
import { FacetRegistry } from '../src/common/facets/FacetRegistry.js'
import { retrieve } from '../src/common/rag/retrieve.js'

/**
 * Graph RAG, for looking at what retrieval finds (the same as the server's
 * /context.json and the dim_context MCP tool): search hits spread along
 * links and topics, each with its text.
 *
 *   node bin/ask.js "what do I know about modular synths?"
 *   node bin/ask.js --json "…"       the full result
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const json = args.includes('--json')
const question = args.filter(a => a !== '--json').join(' ').trim()
if (!question) {
  console.error('Usage: node bin/ask.js [--json] "question"')
  process.exit(1)
}

let app
try {
  app = await buildApp({ config: Config.load(), projectRoot: Config.projectRoot })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const out = await retrieve(question, { registry: new FacetRegistry(app.facets), related: app.related, links: app.links, topics: app.topics })
if (json) console.log(JSON.stringify(out, null, 2))
else {
  if (out.semanticError) console.log(`(words only: ${out.semanticError})\n`)
  for (const i of out.items) {
    console.log(`${i.seed ? '●' : '○'} ${i.score.toFixed(2)} [${i.facetLabel}] ${i.label}  ${i.href}`)
    if (i.via.length) console.log(`    via ${i.via.map(v => `${v.kind}: ${v.label}`).join('; ')}`)
    console.log(`    ${i.text.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  console.log(`\n${out.items.length} items, ${out.edges.length} links between them.`)
}
process.exit(0)
