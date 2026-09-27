import fs from 'fs'
import { join as pathJoin, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { LICENCE, send, sendText, sendHtml, redirect } from './respond.js'
import { readBody } from './body.js'
import { registerStatic } from './staticFiles.js'
import { writeRoute, safeReturn } from './write.js'
import { renderLoginPage, renderFindPage, renderTagsPage, renderTagPage } from '../ui/pages.js'
import { renderTopicsPage, renderTopicPage } from '../ui/topicPages.js'
import { typeSlugOf, toIri } from '../links/mentions.js'
import { LinkError } from '../links/LinkStore.js'

/**
 * Routes that belong to no one facet: home redirect, health, vocabularies,
 * static files, login, search across facets, the /r resolver and links.
 */

export const VOCABULARIES = Object.freeze({
  dim: 'vocabs/dim.ttl',
  shapes: 'vocabs/shapes.ttl'
})

export const STATIC_ROOT = fileURLToPath(new URL('../ui/public/', import.meta.url))

const LOGIN_FAILURE_DELAY_MS = 750

function clampLimit (value, fallback, max = 50) {
  return Math.min(Math.max(Number(value) || fallback, 1), max)
}

export function registerCommonRoutes (router, { registry, services, config, defaultFacet, projectRoot, origin }) {
  router.get('/', ({ response, url }) => redirect(response, 302, `/${defaultFacet}/${url.search}`))

  // 200 when every facet is fine (or only planned), 503 "degraded" when one
  // fails — e.g. the store is down. Strangers get only the status when
  // reads are private.
  router.get('/health', async ({ response, session }) => {
    const facets = await registry.health()
    const client = services.repository?.client
    if (client?.isReachable) facets.store = (await client.isReachable().catch(() => false)) ? { status: 'ok' } : { status: 'error', error: 'SPARQL endpoint not reachable' }
    const status = Object.values(facets).every(f => ['ok', 'planned'].includes(f.status)) ? 'ok' : 'degraded'
    const code = status === 'ok' ? 200 : 503
    if (services.auth.privateReads && !session?.user) return send(response, code, { status })
    return send(response, code, {
      status,
      facets,
      writes: services.auth.writesEnabled ? 'enabled' : 'disabled',
      private: Boolean(services.auth.privateReads),
      embeddingModel: config?.get('embedding.model') ?? null,
      licence: LICENCE
    })
  })

  router.get('/ns', ({ response }) => send(response, 200, {
    vocabularies: Object.keys(VOCABULARIES).map(name => ({ name, url: `/ns/${name}.ttl` })),
    licence: LICENCE
  }))

  router.get(/^\/ns\/([a-z0-9-]+)\.ttl$/, async ({ response, match }) => {
    const file = VOCABULARIES[match[1]]
    if (!file) return send(response, 404, { error: 'No such vocabulary', name: match[1] })
    const body = await fs.promises.readFile(isAbsolute(file) ? file : pathJoin(projectRoot, file), 'utf8')
    return sendText(response, 200, body, 'text/turtle; charset=utf-8')
  })

  registerStatic(router, { prefix: '/static', root: STATIC_ROOT })

  // ── Log in / out ─────────────────────────────────────────────────────
  router.get('/login', ({ response, url, tabs, session }) =>
    sendHtml(response, 200, renderLoginPage({ tabs, session, returnPath: safeReturn(url.searchParams.get('return'), '/') })))

  router.add(['POST'], '/login', async ({ request, response, tabs, session }) => {
    let body
    try {
      body = await readBody(request)
    } catch (error) {
      return send(response, error.status ?? 400, { error: error.message })
    }
    const returnPath = safeReturn(body._return, '/')
    if (!services.auth.verify(body.token)) {
      await new Promise(resolve => setTimeout(resolve, LOGIN_FAILURE_DELAY_MS))
      return sendHtml(response, services.auth.writesEnabled ? 401 : 403,
        renderLoginPage({ tabs, session, returnPath, error: services.auth.writesEnabled ? 'That is not the write token.' : null }))
    }
    response.setHeader('Set-Cookie', services.auth.login())
    return redirect(response, 303, returnPath)
  })

  router.add(['POST'], '/logout', writeRoute(({ request, response }) => {
    response.setHeader('Set-Cookie', services.auth.logout(request))
    return { redirect: '/' }
  }))

  // ── Find across facets ───────────────────────────────────────────────
  const find = async (url) => {
    const q = (url.searchParams.get('q') ?? '').trim()
    return { q, groups: q ? await registry.find(q, { limit: clampLimit(url.searchParams.get('limit'), 10) }) : [] }
  }
  router.get('/find', async ({ response, url, tabs, session }) => {
    const { q, groups } = await find(url)
    return sendHtml(response, 200, renderFindPage({ tabs, session, query: q, groups }))
  })
  // Topics across facets (graph:alignment/topics, bin/topics.js).
  const topics = services.topics
  router.get(/^\/topics(\.json)?$/, async ({ response, match, tabs, session }) => {
    const list = topics ? await topics.list() : []
    return match[1] ? send(response, 200, { topics: list.map(({ members, ...t }) => ({ ...t, count: members.length })) }) : sendHtml(response, 200, renderTopicsPage({ topics: list, tabs, session }))
  })
  router.get(/^\/topics\/([^/]+?)(\.json)?$/, async ({ response, match, tabs, session }) => {
    const topic = topics ? await topics.get(decodeURIComponent(match[1])) : null
    if (!topic) return send(response, 404, { error: 'No such topic' })
    const groups = new Map()
    for (const iri of topic.members) {
      const found = await registry.lookup(iri)
      if (!found?.href || !found.facet) continue
      const g = groups.get(found.facet) ?? { label: found.facetLabel, results: [], total: 0 }
      g.total++
      if (g.results.length < 30) g.results.push({ iri, label: found.label, href: found.href })
      groups.set(found.facet, g)
    }
    const bookmarks = groups.get('gnamgnam')
    if (bookmarks && bookmarks.total > bookmarks.results.length) bookmarks.more = { href: `/gnamgnam/?topic=${encodeURIComponent(topic.label)}`, label: `all ${bookmarks.total} bookmarks on ${topic.label}` }
    const tagged = await registry.tagged(topic.label.toLowerCase())
    const broader = topic.broader ? await topics.byIri(topic.broader) : null
    const narrower = (await Promise.all(topic.narrower.map(i => topics.byIri(i)))).filter(Boolean)
    if (match[2]) return send(response, 200, { topic: { ...topic, members: undefined }, groups: [...groups.values()] })
    return sendHtml(response, 200, renderTopicPage({ topic, broader, narrower, groups: [...groups.values()], tagHref: tagged.length ? `/tags/${encodeURIComponent(topic.label.toLowerCase())}` : null, tabs, session }))
  })

  // Tags across facets: /tags (all), /tags/<tag> (everything with it); .json too.
  router.get(/^\/tags(\.json)?$/, async ({ response, match, tabs, session }) => {
    const tags = await registry.tags()
    return match[1] ? send(response, 200, { tags }) : sendHtml(response, 200, renderTagsPage({ tags, tabs, session }))
  })
  router.get(/^\/tags\/([^/]+?)(\.json)?$/, async ({ response, match, tabs, session }) => {
    let tag
    try { tag = decodeURIComponent(match[1]).trim().toLowerCase() } catch { return send(response, 400, { error: 'Bad tag' }) }
    const groups = await registry.tagged(tag)
    const topic = await services.topics?.forTag(tag)
    return match[2] ? send(response, 200, { tag, groups, topic: topic?.slug ?? null }) : sendHtml(response, 200, renderTagPage({ tag, groups, topic, tabs, session }))
  })

  router.get('/find.json', async ({ response, url }) => {
    const { q, groups } = await find(url)
    return send(response, 200, { query: q, groups })
  })

  // ── /r resolver: a resource's page from its type and slug, or its IRI ─
  router.get(/^\/r\/([a-z][a-z0-9-]*)\/([A-Za-z0-9-]+)$/, ({ response, match }) => {
    const href = registry.href(toIri(`${match[1]}/${match[2]}`))
    return href ? redirect(response, 302, href) : send(response, 404, { error: 'No facet shows that resource', type: match[1], slug: match[2] })
  })
  router.get('/r', ({ response, url }) => {
    const target = url.searchParams.get('iri')
    const href = target && typeSlugOf(target) ? registry.href(target) : null
    return href ? redirect(response, 302, href) : send(response, 404, { error: 'No facet shows that resource', iri: target })
  })

  // ── Links ────────────────────────────────────────────────────────────
  router.get('/links', async ({ response, url }) => {
    const resource = url.searchParams.get('iri')
    if (!resource) return send(response, 400, { error: 'Provide ?iri=' })
    if (!services.links) return send(response, 503, { error: 'No store configured' })
    const links = await Promise.all((await services.links.linksOf(resource)).map(async l => ({ ...l, ...(await registry.lookup(l.iri)) })))
    return send(response, 200, { iri: resource, links })
  })

  const linkArgs = (body) => {
    const from = toIri(body.from, { registry, origin })
    const to = toIri(body.to, { registry, origin })
    if (!from) throw new LinkError(`Not a resource: ${JSON.stringify(body.from ?? '')}`)
    if (!to) throw new LinkError(`Can't tell what to link to from ${JSON.stringify(body.to ?? '')}; paste a URL or [[type/slug]], or pick from the list`)
    return { from, to, kind: String(body.kind ?? 'related') }
  }

  router.add(['POST'], '/links', writeRoute(async ({ body, identity }) => {
    if (!services.links) throw Object.assign(new Error('No store configured'), { status: 503 })
    const args = linkArgs(body)
    await services.links.add({ ...args, actor: identity.user })
    return { redirect: registry.href(args.from) ?? '/', json: { ok: true, link: args } }
  }))

  router.add(['POST'], '/links/delete', writeRoute(async ({ body, identity }) => {
    if (!services.links) throw Object.assign(new Error('No store configured'), { status: 503 })
    const args = linkArgs(body)
    await services.links.remove({ ...args, actor: identity.user })
    // relatedTo is symmetric: remove it whichever way round it was stored.
    if (args.kind === 'related') await services.links.remove({ from: args.to, to: args.from, kind: 'related', actor: identity.user })
    return { redirect: registry.href(args.from) ?? '/', json: { ok: true, removed: args } }
  }))
}
