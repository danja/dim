import { send, sendText, sendHtml } from '../../common/http/respond.js'
import { writeRoute } from '../../common/http/write.js'
import QueryService from '../../common/store/QueryService.js'
import { classify, capture } from '../capture.js'
import { recentActivity } from '../timeline.js'
import { manifest, SERVICE_WORKER } from '../pwa.js'
import { renderHome, renderShare, renderOffline } from './pages.js'

/** Squirt routes, mounted at /squirt. */

const queries = new QueryService()

export function registerRoutes (router, { client, tasks, wiki, mentions, advisor, appName, tabs, services, registry, origin }) {
  const originOf = request => origin ?? `http://${request.headers.host ?? 'localhost'}`
  const activity = session => session.user && client ? recentActivity({ client, queries, registry, session }) : []

  router.get('/squirt', async ({ request, response, url, session }) => {
    const captured = url.searchParams.has('captured') ? { href: url.searchParams.get('captured'), label: url.searchParams.get('label') } : null
    const next = session.user && advisor ? (await advisor.suggest({ limit: 1 }).catch(() => ({ ranked: [] }))).ranked[0] : null
    const coming = session.user ? await registry.upcoming({ days: 2 }).catch(() => []) : []
    return sendHtml(response, 200, renderHome({ items: await activity(session), next, coming, captured, origin: originOf(request), tabs, session }))
  })

  router.get('/squirt/recent.json', async ({ response, session }) =>
    send(response, session.user ? 200 : 401, session.user ? { items: await activity(session) } : { error: 'Log in to see recent activity' }))

  // The share target (and the bookmarklet): a capture form, filled in.
  router.get('/squirt/share', async ({ response, url, session }) => {
    const values = { title: url.searchParams.get('title') ?? '', text: url.searchParams.get('text') ?? '', url: url.searchParams.get('url') ?? '', returnPath: url.pathname + url.search }
    let guess = null
    let existing = null
    try {
      const item = classify(values)
      guess = item.kind
      if (item.url) existing = await registry.urlStatus(item.url)
    } catch { /* nothing shared */ }
    return sendHtml(response, 200, renderShare({ values, guess, existing, tabs, session }))
  })

  router.add(['POST'], '/squirt/capture', writeRoute(async ({ body, identity }) => {
    const item = classify({ text: body.text, url: body.url, title: body.title, kind: body.kind })
    const done = await capture(item, { tasks, wiki, mentions, client, repository: services.repository, registry, actor: identity.user })
    const back = `/squirt/?captured=${encodeURIComponent(done.href ?? '')}&label=${encodeURIComponent(done.label ?? '')}`
    return { redirect: back, json: { ok: true, ...done } }
  }))

  router.get('/squirt/manifest.webmanifest', ({ response }) =>
    sendText(response, 200, JSON.stringify(manifest({ name: appName }), null, 2), 'application/manifest+json'))

  router.get('/squirt/sw.js', ({ response }) => {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' })
    response.end(SERVICE_WORKER)
  })

  router.get('/squirt/offline', ({ response, tabs: t }) => sendHtml(response, 200, renderOffline({ tabs: t ?? tabs })))
}

export default registerRoutes
