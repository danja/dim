import { sendHtml, redirect } from '../../common/http/respond.js'
import { writeRoute } from '../../common/http/write.js'
import { renderAdminPage, ADMIN_PATH } from './adminPage.js'

/**
 * Manage feeds (/news/admin): the page, and one POST for whatever is ticked
 * — feeds (reread, set aside, return, delete) and inbox suggestions
 * (subscribe, dismiss).
 */

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function registerAdminRoutes (router, { store, poller, inbox = null, tabs, registry }) {
  // Each suggestion with the first bookmark it was found on, for a link.
  const withSources = async suggestions => Promise.all(suggestions.map(async s => {
    const first = s.sources[0] ? await registry.lookup(s.sources[0]).catch(() => null) : null
    return { ...s, source: first?.href ? { label: first.label, href: first.href } : null }
  }))

  router.get(ADMIN_PATH, async ({ response, url, session }) =>
    sendHtml(response, 200, renderAdminPage({ feeds: await store.feedList(), counts: await store.counts(), suggestions: inbox ? await withSources(await inbox.list()) : null, notice: url.searchParams.get('notice'), polling: Boolean(poller.running), tabs, session })))

  // The old subscriptions page is the admin page now.
  router.get('/news/feeds', ({ response, url }) => redirect(response, 301, ADMIN_PATH + url.search))

  const done = notice => ({ redirect: `${ADMIN_PATH}?notice=${encodeURIComponent(notice)}`, json: { ok: true, notice } })

  async function onSuggestions (action, ids, actor) {
    const ticked = inbox ? await inbox.byIds(ids) : []
    if (!ticked.length) return done('Nothing ticked.')
    if (action === 'dismiss') {
      await inbox.dismiss(ticked)
      return done(`Dismissed ${plural(ticked.length, 'suggestion')}.`)
    }
    const added = []
    for (const s of ticked) {
      if (!(await store.feedByUrl(s.url))) {
        let siteUrl = null
        try { siteUrl = new URL(s.foundOn).origin + '/' } catch { /* none */ }
        added.push(await store.addFeed({ url: s.url, title: s.title || s.url, siteUrl }, actor))
      }
    }
    await inbox.remove(ticked)
    // Read them now; one that doesn't work is set aside as failing.
    if (added.length && !poller.running) poller.pollDue({ feeds: added }).catch(() => {})
    return done(`Subscribed to ${plural(added.length, 'feed')}${added.length ? '; reading them in the background' : ''}.`)
  }

  router.add(['POST'], ADMIN_PATH, writeRoute(async ({ body, identity }) => {
    const action = String(body.action ?? '')
    if (action === 'subscribe' || action === 'dismiss') return onSuggestions(action, [body.suggestions ?? []].flat().map(String), identity.user)
    const slugs = [body.slugs ?? []].flat().map(String).slice(0, 5000)
    const all = await store.feedList()
    const ticked = all.filter(f => slugs.includes(f.slug))
    if (action === 'reread' || action === 'reread-all') {
      const feeds = action === 'reread-all' ? all.filter(f => !f.parked) : ticked
      if (!feeds.length) return done('Nothing ticked.')
      if (poller.running) return done('Feeds are already being read; try again when that has finished.')
      // Whole feeds (no conditional GET), in the background: a feed that works leaves the failing list.
      poller.pollDue({ feeds, refetch: true }).catch(() => {})
      return done(`Rereading ${plural(feeds.length, 'feed')} in the background.`)
    }
    if (!ticked.length) return done('Nothing ticked.')
    if (action === 'park' || action === 'unpark') {
      for (const f of ticked) await store.setParked(f, action === 'park')
      return done(`${action === 'park' ? 'Set aside' : 'Returned to reading'}: ${plural(ticked.length, 'feed')}.`)
    }
    if (action === 'delete') {
      let items = 0
      for (const f of ticked) items += await store.deleteFeed(f, identity.user)
      return done(`Deleted ${plural(ticked.length, 'feed')} and ${items} items.`)
    }
    throw Object.assign(new Error(`Unknown action "${action}"`), { status: 400 })
  }))
}

export default registerAdminRoutes
