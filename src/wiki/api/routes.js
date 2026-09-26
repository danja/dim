import { send, sendText, sendHtml, redirect } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { wantsJson } from '../../common/http/body.js'
import { diffLines, diffStats } from '../../common/text/diff.js'
import { slugForTitle } from '../rdf.js'
import { WikiError } from '../WikiStore.js'
import { mentionSync } from '../mentionSync.js'
import { pagePath, contentHtml } from './common.js'
import { renderIndex, renderView, renderMissing, renderHistory, renderRevision, renderDiffPage } from './view.js'
import { renderEdit, renderConflict } from './edit.js'

/** Wiki HTTP routes, mounted at /wiki. */

const SLUG = '([a-z0-9][a-z0-9-]*)'
const PAGE = new RegExp(`^/wiki/page/${SLUG}(\\.md|\\.ttl|\\.json)?$`)

function notFound (what) {
  return Object.assign(new Error(`No such ${what}`), { status: 404 })
}

async function linksFor ({ services, registry }, resourceIri) {
  if (!services?.links) return null
  try {
    const links = await services.links.linksOf(resourceIri)
    return Promise.all(links.map(async l => ({ ...(await registry.lookup(l.iri)), kind: l.kind, direction: l.direction, iri: l.iri })))
  } catch (error) {
    return { error: error.message }
  }
}

export function registerRoutes (router, { store, tabs, services, registry, origin }) {
  const existing = async slug => {
    const page = await store.get(slug)
    if (!page) throw notFound('page')
    return page
  }

  const mentions = mentionSync({ store, links: services?.links, registry, origin })

  router.get('/wiki', async ({ response, url, session }) =>
    sendHtml(response, 200, renderIndex({ pages: await store.list(), tag: url.searchParams.get('tag'), tabs, session })))

  router.get('/wiki/new', async ({ response, url }) => {
    const title = (url.searchParams.get('title') ?? '').trim()
    if (!title) return redirect(response, 303, '/wiki/')
    const page = await store.byTitle(title)
    return redirect(response, 303, page ? pagePath(page) : `/wiki/page/${slugForTitle(title)}/edit?title=${encodeURIComponent(title)}`)
  })

  router.get(PAGE, async ({ request, response, url, match, session }) => {
    const page = await store.get(match[1])
    if (!page) {
      if (match[2]) return send(response, 404, { error: 'No such page', slug: match[1] })
      return sendHtml(response, 404, renderMissing({ slug: match[1], title: url.searchParams.get('title'), tabs, session }))
    }
    if (match[2] === '.md') return sendText(response, 200, page.content, 'text/markdown; charset=utf-8')
    if (match[2] === '.ttl') return sendText(response, 200, await store.turtle(page), 'text/turtle; charset=utf-8')
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, page)
    return sendHtml(response, 200, renderView({ page, pages: await store.list(), links: await linksFor({ services, registry }, page.iri), tabs, session }))
  })

  router.get(new RegExp(`^/wiki/page/${SLUG}/edit$`), async ({ response, url, match, session }) => {
    if (!session.user) return redirect(response, 303, `/login?return=${encodeURIComponent(url.pathname + url.search)}`)
    const page = await store.get(match[1])
    const draft = page
      ? { slug: page.slug, title: page.title, content: page.content, tags: page.tags.join(', '), base: page.revision }
      : { slug: match[1], title: url.searchParams.get('title') ?? match[1].replace(/-/g, ' '), content: '', tags: '', base: 0 }
    return sendHtml(response, 200, renderEdit({ draft, page, pages: await store.list(), tabs, session }))
  })

  router.get(new RegExp(`^/wiki/page/${SLUG}/history$`), async ({ response, match, session }) => {
    const page = await existing(match[1])
    return sendHtml(response, 200, renderHistory({ page, revisions: await store.revisions(page), tabs, session }))
  })

  router.get(new RegExp(`^/wiki/page/${SLUG}/r/([0-9]+)$`), async ({ response, match, session }) => {
    const page = await existing(match[1])
    const revision = await store.revision(page, Number(match[2]))
    if (!revision) return send(response, 404, { error: 'No such revision' })
    return sendHtml(response, 200, renderRevision({ page, revision, pages: await store.list(), tabs, session }))
  })

  router.get(new RegExp(`^/wiki/page/${SLUG}/diff$`), async ({ response, url, match, session }) => {
    const page = await existing(match[1])
    const to = await store.revision(page, Number(url.searchParams.get('to') ?? page.revision))
    const from = await store.revision(page, Number(url.searchParams.get('from') ?? (to?.n ?? 1) - 1))
    if (!from || !to) return send(response, 404, { error: 'No such revision' })
    const diff = diffLines(from.content, to.content)
    return sendHtml(response, 200, renderDiffPage({ page, from, to, diff, stats: diff && diffStats(diff), tabs, session }))
  })

  // ── Writes ───────────────────────────────────────────────────────────

  router.add(['POST'], new RegExp(`^/wiki/page/${SLUG}$`), writeRoute(async ({ request, match, body, identity, session }) => {
    const current = await store.get(match[1])
    const draft = {
      slug: match[1],
      title: String(body.title ?? current?.title ?? '').trim(),
      content: String(body.content ?? '').replace(/\r\n/g, '\n'),
      tags: String(body.tags ?? ''),
      base: Number(body.base ?? 0) || 0
    }
    const pages = await store.list()
    if (body.action === 'preview') {
      if (wantsJson(request)) return { json: { ok: true, html: contentHtml(draft.content, pages) } }
      return { html: renderEdit({ draft, page: current, pages, preview: true, tabs, session }) }
    }
    let page
    try {
      page = await store.save({ slug: draft.slug, title: draft.title, content: draft.content, tags: body.tags, baseRevision: draft.base, actor: identity.user })
    } catch (error) {
      if (!(error instanceof WikiError) || error.status !== 409 || !error.current) throw error
      const base = draft.base ? await store.revision(error.current, draft.base) : null
      const theirs = diffLines(base?.content ?? '', error.current.content)
      return {
        status: 409,
        json: { error: error.message, revision: error.current.revision },
        html: renderConflict({ draft, current: error.current, theirs, pages, tabs, session })
      }
    }
    await mentions.sync(page, identity.user)
    if (page.revision === 1) await mentions.syncWaiting(page, identity.user)
    return { redirect: pagePath(page), json: { ok: true, slug: page.slug, iri: page.iri, revision: page.revision } }
  }))

  router.add(['POST'], new RegExp(`^/wiki/page/${SLUG}/delete$`), writeRoute(async ({ match, identity }) => {
    await store.delete(await existing(match[1]), identity.user)
    return { redirect: '/wiki/', json: { ok: true } }
  }))
}

export default registerRoutes
