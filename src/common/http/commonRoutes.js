import fs from 'fs'
import { join as pathJoin, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { LICENCE, send, sendText, sendHtml, redirect } from './respond.js'
import { readBody } from './body.js'
import { registerStatic } from './staticFiles.js'
import { writeRoute, safeReturn } from './write.js'
import { renderLoginPage, renderFindPage } from '../ui/pages.js'
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

  router.get('/health', async ({ response }) => send(response, 200, {
    status: 'ok',
    facets: await registry.health(),
    writes: services.auth.writesEnabled ? 'enabled' : 'disabled',
    embeddingModel: config?.get('embedding.model') ?? null,
    licence: LICENCE
  }))

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
