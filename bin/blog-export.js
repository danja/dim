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
import PostStore from '../src/blog/PostStore.js'
import { buildSite } from '../src/blog/staticSite.js'

/**
 * Export the published posts as a static site, for hosting anywhere (the
 * app itself stays on localhost).
 *
 *   node bin/blog-export.js --out data/blog-site --base-url https://example.org/blog/
 *     [--title "My blog"] [--author "Name"]
 *
 * Drafts are never exported. Links to other posts become relative links;
 * links into the rest of DIM become plain text. The output directory is
 * replaced on each run — but only if it is empty or was made by this tool.
 */

logger.setLevel('warn')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const MARKER = '.dim-blog-export'
const config = Config.load()
const out = path.resolve(Config.projectRoot, option('--out', 'data/blog-site'))
const baseUrl = option('--base-url', process.env.BLOG_BASE_URL || 'http://localhost/')
const title = option('--title', process.env.BLOG_TITLE || 'Blog')
const author = option('--author', process.env.BLOG_AUTHOR || 'owner')

if (fs.existsSync(out)) {
  const entries = fs.readdirSync(out)
  if (entries.length && !entries.includes(MARKER)) {
    console.error(`${out} is not empty and was not made by blog-export; choose another --out.`)
    process.exit(1)
  }
  fs.rmSync(out, { recursive: true, force: true })
}

const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
const posts = await new PostStore({ client, repository }).list()

const files = buildSite(posts, { title, author, baseUrl })
for (const [rel, content] of files) {
  const file = path.join(out, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
fs.writeFileSync(path.join(out, MARKER), `Made by bin/blog-export.js at ${new Date().toISOString()}\n`)
console.log(`Exported ${posts.length} published posts (${files.size} files) to ${out}`)
console.log(`  feed: ${baseUrl.replace(/\/?$/, '/')}feed.atom — preview with: python3 -m http.server -d ${out}  (or any static server)`)
