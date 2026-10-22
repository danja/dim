#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import { buildApp } from '../src/app.js'
import { FacetRegistry } from '../src/common/facets/FacetRegistry.js'
import { tune, OPTION_NAMES } from '../src/common/rag/options.js'
import { retrieve } from '../src/common/rag/retrieve.js'

/**
 * Graph RAG, for looking at what retrieval finds (the same as the server's
 * /context.json and the dim_context MCP tool): search hits spread along
 * links and topics, each with its text.
 *
 *   node bin/ask.js "what do I know about modular synths?"
 *   node bin/ask.js --json "…"       the full result
 *
 * Settings are tried per run with flags named as in options.js, e.g.
 *   --hops 1 --similar --communities --fanout 6 --wRelated 1
 * (flags without a value are switches). The settings used are printed.
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const json = args.includes('--json')
const pairs = []
const words = []
for (let i = 0; i < args.length; i++) {
  const name = args[i].replace(/^--/, '')
  if (args[i] === '--json') continue
  if (args[i].startsWith('--') && OPTION_NAMES.includes(name)) {
    const next = args[i + 1]
    pairs.push([name, next && !next.startsWith('--') && !Number.isNaN(Number(next)) ? args[++i] : ''])
  } else words.push(args[i])
}
const question = words.join(' ').trim()
const config = tune(pairs)
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
const out = await retrieve(question, { registry: new FacetRegistry(app.facets), related: app.related, links: app.links, topics: app.topics, hashtags: app.hashtags, communities: app.communities, config })
if (json) console.log(JSON.stringify(out, null, 2))
else {
  if (out.semanticError) console.log(`(words only: ${out.semanticError})\n`)
  for (const i of out.items) {
    console.log(`${i.seed ? '●' : '○'} ${i.score.toFixed(2)} [${i.facetLabel}] ${i.label}  ${i.href}`)
    if (i.via.length) console.log(`    via ${i.via.map(v => `${v.kind}: ${v.label}`).join('; ')}`)
    console.log(`    ${i.text.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  for (const c of out.communities) console.log(`◆ cluster ${c.score.toFixed(2)} (${c.size} items): ${c.summary.replace(/\s+/g, ' ').slice(0, 200)}`)
  console.log(`\n${out.items.length} items, ${out.edges.length} links between them.`)
}
process.exit(0)
