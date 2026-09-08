import http from 'http'
import fs from 'fs'
import { join as pathJoin, isAbsolute } from 'path'
import logger from 'loglevel'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * DIM public read API. Adapted from plugin-universe src/api/server.js,
 * trimmed to bookmarks: search, facets, browse, one bookmark, health, vocabs.
 * Dependency-free node:http, CORS-open (CC0 catalogue data).
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60'
}

function sendText (response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}

export function negotiate (suffix, acceptHeader = '') {
  if (suffix === '.ttl') return 'turtle'
  if (suffix === '.jsonld') return 'jsonld'
  if (suffix === '.json') return 'json'
  const accept = acceptHeader.toLowerCase()
  if (accept.includes('text/turtle')) return 'turtle'
  if (accept.includes('application/ld+json')) return 'jsonld'
  if (accept.includes('application/json')) return 'json'
  if (accept.includes('text/html')) return 'html'
  return 'html'
}

function send (response, status, body) {
  const payload = JSON.stringify(body, null, 2)
  response.writeHead(status, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(payload) })
  response.end(payload)
}

const LICENCE = {
  licence: 'CC0-1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'DIM — Danny\'s Information Manager (requested, not required)'
}

export const VOCABULARIES = Object.freeze({
  dim: 'vocabs/dim.ttl',
  shapes: 'vocabs/shapes.ttl'
})

function esc (s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderSearchPage ({ query, facets, results, total, corpus, elapsedMs, facetValues }) {
  const items = results.map(r => `<li><a href="${esc(r.url)}">${esc(r.name)}</a> <small>${esc(r.domain ?? '')} · ${esc((r.bookmarkTypes || []).join(', '))} · ${typeof r.score === 'number' ? r.score.toFixed(3) : ''}</small>${r.description ? `<br><small>${esc(r.description.slice(0, 200))}</small>` : ''}</li>`).join('\n')
  const typeOpts = (facetValues.bookmarkType ?? []).slice(0, 30).map(f => `<option value="${esc(f.value)}">${esc(f.value)} (${f.count})</option>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>DIM${query ? ' — ' + esc(query) : ''}</title></head><body>
<h1>DIM — Danny's Information Manager</h1>
<form method="get" action="/"><input name="q" value="${esc(query ?? '')}" size="60" placeholder="search bookmarks…">
<select name="bookmarkType"><option value="">all types</option>${typeOpts}</select>
<button>Search</button></form>
<p>${total} of ${corpus} bookmarks${elapsedMs != null ? `, ${elapsedMs}ms` : ''}</p>
<ul>${items}</ul>
<p><a href="/facets">facets</a> · <a href="/health">health</a></p>
</body></html>`
}

function bookmarkTurtle (doc) {
  const nm = new (Object.getPrototypeOf(NAMESPACES).constructor || Object)()
  const lines = [`@prefix dim: <${NAMESPACES.dim}> .`, `@prefix rdfs: <${NAMESPACES.rdfs}> .`, `@prefix dcterms: <${NAMESPACES.dcterms}> .`, '']
  lines.push(`<${doc.iri}> a dim:Bookmark ;`)
  lines.push(`  rdfs:label "${doc.name.replace(/"/g, '\\"')}" ;`)
  lines.push(`  dim:url <${doc.url}> ;`)
  for (const t of doc.bookmarkTypes ?? []) lines.push(`  dim:bookmarkType <${NAMESPACES.dim}concept/${t}> ;`)
  lines.push('  .')
  return lines.join('\n')
}

export function createServer ({ search, config, projectRoot = process.cwd() }) {
  if (!search) throw new Error('The API server needs a SearchService')

  return http.createServer(async (request, response) => {
    const started = Date.now()
    let url
    try {
      url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    } catch {
      return send(response, 400, { error: 'Malformed URL' })
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, JSON_HEADERS)
      return response.end()
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return send(response, 405, { error: 'This API is read-only' })
    }

    try {
      const path = url.pathname.replace(/\/$/, '') || '/'
      const params = url.searchParams

      switch (path) {
        case '/': {
          const q = params.get('q')
          const facets = {
            bookmarkType: params.get('bookmarkType') || params.get('type') || null,
            domain: params.get('domain') || null
          }
          const hasCriteria = Boolean(q) || Object.values(facets).some(Boolean)
          const outcome = hasCriteria
            ? (q ? await search.search(q, { facets, limit: 25 }) : await search.browse({ facets, limit: 25 }))
            : { results: [], total: 0 }
          return sendText(response, 200, renderSearchPage({
            query: q,
            facets,
            results: outcome.results,
            total: outcome.total,
            corpus: search.documents.size,
            elapsedMs: hasCriteria ? Date.now() - started : undefined,
            facetValues: await search.facets()
          }), 'text/html; charset=utf-8')
        }
        case '/health': {
          return send(response, 200, {
            status: 'ok',
            bookmarks: search.documents.size,
            index: search.index.size,
            embeddingModel: config?.get('embedding.model') ?? null,
            licence: LICENCE
          })
        }
        case '/search': {
          const q = params.get('q')
          const facets = {
            bookmarkType: params.get('bookmarkType') || params.get('type') || null,
            domain: params.get('domain') || null
          }
          const limit = Math.min(
            Number(params.get('limit')) || RETRIEVAL_CONFIG.defaultPageSize,
            RETRIEVAL_CONFIG.maxPageSize
          )
          if (!q && !Object.values(facets).some(Boolean)) {
            return send(response, 400, { error: 'Provide q, or at least one of bookmarkType, domain' })
          }
          const outcome = q
            ? await search.search(q, { facets, limit })
            : await search.browse({ facets, limit })
          return send(response, 200, {
            query: q ?? null,
            facets: Object.fromEntries(Object.entries(facets).filter(([, v]) => v)),
            total: outcome.total,
            count: outcome.results.length,
            elapsedMs: Date.now() - started,
            results: outcome.results,
            signals: outcome.signals ?? null,
            licence: LICENCE
          })
        }
        case '/facets': {
          return send(response, 200, { facets: await search.facets(), licence: LICENCE })
        }
        case '/bookmarks': {
          const outcome = await search.browse({ limit: Math.min(Number(params.get('limit')) || 50, RETRIEVAL_CONFIG.maxPageSize) })
          return send(response, 200, { total: outcome.total, results: outcome.results, licence: LICENCE })
        }
        case '/ns': {
          return send(response, 200, {
            vocabularies: Object.keys(VOCABULARIES).map(name => ({ name, url: `/ns/${name}.ttl` })),
            licence: LICENCE
          })
        }
        default: {
          const vocab = path.match(/^\/ns\/([a-z0-9-]+)\.ttl$/)
          if (vocab) {
            const file = VOCABULARIES[vocab[1]]
            if (!file) return send(response, 404, { error: 'No such vocabulary', name: vocab[1] })
            const body = await fs.promises.readFile(isAbsolute(file) ? file : pathJoin(projectRoot, file), 'utf8')
            return sendText(response, 200, body, 'text/turtle; charset=utf-8')
          }
          const match = path.match(/^\/bookmark\/([A-Za-z0-9-]+?)(\.ttl|\.json)?$/)
          if (match) {
            const iri = `${NAMESPACES.dim}bookmark/${match[1]}`
            const doc = search.documents.get(iri)
            if (!doc) return send(response, 404, { error: 'No such bookmark', iri })
            if (negotiate(match[2], request.headers.accept) === 'turtle') {
              return sendText(response, 200, bookmarkTurtle(doc), 'text/turtle; charset=utf-8')
            }
            return send(response, 200, { ...doc, licence: LICENCE })
          }
          return send(response, 404, { error: 'No such endpoint', path })
        }
      }
    } catch (error) {
      logger.error('[api]', error)
      return send(response, 500, { error: error.message })
    }
  })
}

export default createServer
