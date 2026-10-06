import { send, sendHtml, redirect } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { renderIndex, renderEdit } from './pages.js'
import { eventPath } from '../render.js'

/**
 * Calendar HTTP routes, mounted at /calendar. Appointments are personal, so
 * every route needs the owner: a browser is sent to log in, anything asking for
 * JSON gets 401.
 */

const SLUG = '([a-z0-9][a-z0-9-]*)'
const FIELDS = ['title', 'date', 'time', 'location', 'notes']

const pick = body => Object.fromEntries(FIELDS.filter(k => k in body).map(k => [k, body[k]]))

export function registerRoutes (router, { store, tabs }) {
  // → true when the request was answered (not the owner). suffix: ".json" on the URL.
  const refuse = ({ request, response, url, session }, suffix = '') => {
    if (session.user) return false
    if (negotiate(suffix, request.headers.accept) !== 'html') send(response, 401, { error: 'Log in, or send the write token' })
    else redirect(response, 303, `/login?return=${encodeURIComponent(url.pathname + url.search)}`)
    return true
  }
  const found = async slug => {
    const event = await store.get(slug)
    if (!event) throw Object.assign(new Error('No such appointment'), { status: 404 })
    return event
  }

  router.get('/calendar', async ctx => {
    if (refuse(ctx)) return
    const { response, url, session } = ctx
    const view = url.searchParams.get('view') === 'past' ? 'past' : 'upcoming'
    const events = await store.list({ view })
    if (negotiate('', ctx.request.headers.accept) !== 'html') return send(response, 200, { view, events })
    return sendHtml(response, 200, renderIndex({ events, view, today: store.today(), tabs, session }))
  })

  router.get(new RegExp(`^/calendar/event/${SLUG}(\\.json)?$`), async ctx => {
    if (refuse(ctx, ctx.match[2])) return
    const { request, response, match } = ctx
    const event = await found(match[1])
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, event)
    return redirect(response, 302, `${eventPath(event)}/edit`)
  })

  router.get(new RegExp(`^/calendar/event/${SLUG}/edit$`), async ctx => {
    if (refuse(ctx)) return
    const { response, match, session } = ctx
    return sendHtml(response, 200, renderEdit({ event: await found(match[1]), tabs, session }))
  })

  // ── Writes ───────────────────────────────────────────────────────────

  router.add(['POST'], '/calendar/events', writeRoute(async ({ body, identity }) => {
    const event = await store.create(pick(body), identity.user)
    return { redirect: '/calendar/', json: { ok: true, slug: event.slug, iri: event.iri } }
  }))

  router.add(['POST'], new RegExp(`^/calendar/event/${SLUG}$`), writeRoute(async ({ match, body, identity }) => {
    const event = await store.update(await found(match[1]), pick(body), identity.user)
    return { redirect: '/calendar/', json: { ok: true, slug: event.slug } }
  }))

  router.add(['POST'], new RegExp(`^/calendar/event/${SLUG}/delete$`), writeRoute(async ({ match, identity }) => {
    await store.delete(await found(match[1]), identity.user)
    return { redirect: '/calendar/', json: { ok: true } }
  }))
}

export default registerRoutes
