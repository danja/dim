import { send, sendText, sendHtml, redirect } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { parseSubscriptions, toOpml } from '../formats/opml.js'
import { absoluteUrl } from '../formats/feed.js'
import { resolveFeed } from '../subscribe.js'
import { hostOf } from '../../common/links/urls.js'
import { saveAsBookmark, makeTask } from '../saveAs.js'
import { itemPath, feedPath } from './common.js'
import { renderRiver, renderItemPage, riverQuery } from './river.js'
import { renderFeedsPage, renderFeedPage } from './feedsPage.js'
import { resolvedLinks } from '../../common/links/resolvedLinks.js'

/** News HTTP routes, mounted at /news. */

const ID = '([a-f0-9]{16})'
const SLUG = '([a-z0-9][a-z0-9-]*)'
const flag = v => v === undefined ? undefined : v === true || v === 'true' || v === 'on' || v === '1'

function notFound (what) {
  return Object.assign(new Error(`No such ${what}`), { status: 404 })
}

function queryOf (url) {
  const p = url.searchParams
  const view = ['all', 'starred'].includes(p.get('view')) ? p.get('view') : 'unread'
  return { view, feed: p.get('feed') || null, tag: p.get('tag') || null, before: p.get('before') || null }
}

export function registerRoutes (router, { store, poller, tasks, fetchImpl, tabs, services, registry }) {
  const feedMap = async () => new Map((await store.feedList()).map(f => [f.iri, f]))
  // Items whose link is already a bookmark: id → { href, label }.
  const bookmarkedOf = async items => {
    const out = new Map()
    for (const i of items) {
      const s = i.link ? await registry.urlStatus(i.link) : null
      if (s?.href) out.set(i.id, s)
    }
    return out
  }
  const item = async id => (await store.item(id)) ?? Promise.reject(notFound('item'))
  const feed = async slug => (await store.feed(slug)) ?? Promise.reject(notFound('feed'))

  router.get('/news', async ({ response, url, session }) => {
    const query = queryOf(url)
    const feedList = await store.feedList()
    const { items, more } = await store.itemList(query)
    const unread = [...(await store.counts()).values()].reduce((n, c) => n + c.unread, 0)
    const tags = [...new Set(feedList.flatMap(f => f.tags))].sort()
    return sendHtml(response, 200, renderRiver({ items, more, feeds: new Map(feedList.map(f => [f.iri, f])), feedList, tags, unread, query, polling: url.searchParams.has('polling'), tabs, session, returnPath: `/news/${riverQuery(query)}`, bookmarked: await bookmarkedOf(items) }))
  })

  router.get('/news/items.json', async ({ response, url }) => {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500)
    const { items, more } = await store.itemList({ ...queryOf(url), limit })
    return send(response, 200, { items: items.map(i => ({ ...i, href: itemPath(i) })), more })
  })

  router.get(new RegExp(`^/news/item/${ID}(\\.json)?$`), async ({ request, response, match, session }) => {
    const it = await item(match[1])
    const text = await store.itemText(it)
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, { ...it, text })
    const bookmark = it.link ? await registry.urlStatus(it.link) : null
    return sendHtml(response, 200, renderItemPage({ item: it, feed: await store.feedByIri(it.feed), text, links: await resolvedLinks({ services, registry }, it.iri), bookmark, tabs, session }))
  })

  router.get('/news/feeds', async ({ response, url, session }) =>
    sendHtml(response, 200, renderFeedsPage({ feeds: await store.feedList(), counts: await store.counts(), notice: url.searchParams.get('notice'), tabs, session })))

  router.get('/news/feeds.opml', async ({ response }) =>
    sendText(response, 200, toOpml(await store.feedList()), 'text/x-opml; charset=utf-8'))

  router.get(new RegExp(`^/news/feed/${SLUG}(\\.json)?$`), async ({ request, response, url, match, session }) => {
    const f = await feed(match[1])
    const count = (await store.counts()).get(f.iri) ?? { total: 0, unread: 0, starred: 0 }
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, { ...f, ...count })
    const query = { ...queryOf(url), feed: null }
    const list = await store.itemList({ ...query, feed: f.slug })
    const alsoHere = (await registry.aboutDomain(hostOf(f.siteUrl ?? f.url))).filter(a => a.facet !== 'news')
    return sendHtml(response, 200, renderFeedPage({ feed: f, count, list, feeds: await feedMap(), query, alsoHere, bookmarked: await bookmarkedOf(list.items), tabs, session }))
  })

  // ── Writes ───────────────────────────────────────────────────────────

  router.add(['POST'], '/news/items/flags', writeRoute(async ({ body }) => {
    const ids = (Array.isArray(body.ids) ? body.ids : String(body.ids ?? '').split(',')).map(s => String(s).trim()).filter(Boolean).slice(0, 1000)
    const items = (await Promise.all(ids.map(id => store.item(id)))).filter(Boolean)
    const changed = await store.setFlags(items, { read: flag(body.read), starred: flag(body.starred) })
    return { redirect: '/news/', json: { ok: true, changed, items: items.map(i => ({ id: i.id, read: i.read, starred: i.starred })) } }
  }))

  router.add(['POST'], new RegExp(`^/news/item/${ID}/bookmark$`), writeRoute(async ({ match, identity }) => {
    const it = await item(match[1])
    const saved = await saveAsBookmark({ item: it, feed: await store.feedByIri(it.feed), text: await store.itemText(it), client: store.client, repository: store.repository, links: services.links, news: store, actor: identity.user })
    await registry.refresh(saved.iri).catch(() => {})
    const href = registry.href(saved.iri)
    return { redirect: itemPath(it), json: { ok: true, ...saved, href } }
  }))

  router.add(['POST'], new RegExp(`^/news/item/${ID}/task$`), writeRoute(async ({ match, identity }) => {
    const it = await item(match[1])
    const task = await makeTask({ item: it, feed: await store.feedByIri(it.feed), tasks, links: services.links, news: store, actor: identity.user })
    return { redirect: `/farelo/task/${task.id}`, json: { ok: true, id: task.id, iri: task.iri } }
  }))

  router.add(['POST'], '/news/feeds', writeRoute(async ({ body, identity }) => {
    const found = await resolveFeed(body.url, { fetchImpl })
    const existing = await store.feedByUrl(found.url)
    if (existing) return { redirect: feedPath(existing), json: { ok: true, slug: existing.slug, existing: true } }
    const f = await store.addFeed({ url: found.url, title: found.title, siteUrl: found.siteUrl, tags: body.tags, format: found.format }, identity.user)
    const result = await poller.pollFeed(f)
    return { redirect: feedPath(f), json: { ok: true, slug: f.slug, poll: result, alternatives: found.alternatives } }
  }))

  router.add(['POST'], '/news/feeds/import', writeRoute(async ({ body, identity }) => {
    const entries = parseSubscriptions(body.list ?? '')
    let added = 0
    for (const e of entries) {
      const url = absoluteUrl(e.url, null)
      if (!url || await store.feedByUrl(url)) continue
      await store.addFeed({ url, title: e.title || url, tags: e.tags }, identity.user)
      added++
    }
    const notice = `Imported ${added} of ${entries.length} feeds; they are polled on the next run.`
    return { redirect: `/news/feeds?notice=${encodeURIComponent(notice)}`, json: { ok: true, added, found: entries.length } }
  }))

  router.add(['POST'], new RegExp(`^/news/feed/${SLUG}$`), writeRoute(async ({ match, body, identity }) => {
    const f = await feed(match[1])
    await store.updateFeed(f, { title: body.title, tags: body.tags }, identity.user)
    return { redirect: feedPath(f), json: { ok: true } }
  }))

  router.add(['POST'], new RegExp(`^/news/feed/${SLUG}/poll$`), writeRoute(async ({ match }) => {
    const f = await feed(match[1])
    return { redirect: feedPath(f), json: { ok: true, ...(await poller.pollFeed(f)) } }
  }))

  router.add(['POST'], new RegExp(`^/news/feed/${SLUG}/delete$`), writeRoute(async ({ match, identity }) => {
    const deleted = await store.deleteFeed(await feed(match[1]), identity.user)
    return { redirect: '/news/feeds', json: { ok: true, deleted } }
  }))

  router.add(['POST'], '/news/poll', writeRoute(async () => {
    poller.pollDue().catch(() => {})
    return { redirect: '/news/?polling=1', json: { ok: true, started: true } }
  }))

  router.get('/news/feed', ({ response }) => redirect(response, 301, '/news/feeds'))
}

export default registerRoutes
