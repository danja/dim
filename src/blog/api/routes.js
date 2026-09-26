import { send, sendText, sendHtml, redirect } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { wantsJson } from '../../common/http/body.js'
import { toIri } from '../../common/links/mentions.js'
import { draftFrom } from '../sources.js'
import { appPath, datedPath, atomFeed, postHtml } from '../render.js'
import { renderIndex, renderTag, renderPost } from './pages.js'
import { renderEdit } from './edit.js'

/**
 * Blog HTTP routes, mounted at /blog. Drafts exist only for the logged-in
 * owner: anyone else gets 404 for them, and they never reach the feed.
 */

const SLUG = '([a-z0-9][a-z0-9-]*)'

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

export function registerRoutes (router, { store, wiki, outlines, blogTitle, blogAuthor, tabs, services, registry, origin }) {
  const visible = async (slug, session) => {
    const post = await store.get(slug)
    if (!post || (post.status !== 'published' && !session.user)) throw notFound('post')
    return post
  }
  const showPost = async ({ response, post, session }) => {
    const published = await store.list()
    const source = post.derivedFrom ? await registry.lookup(post.derivedFrom) : null
    return sendHtml(response, 200, renderPost({ post, posts: await store.list({ drafts: true }), published, source, links: await linksFor({ services, registry }, post.iri), tabs, session }))
  }

  router.get('/blog', async ({ response, session }) => {
    const all = await store.list({ drafts: true })
    return sendHtml(response, 200, renderIndex({ published: all.filter(p => p.status === 'published'), drafts: all.filter(p => p.status === 'draft'), blogTitle, tabs, session }))
  })

  router.get(/^\/blog\/tag\/([^/]+)$/, async ({ response, match, session }) => {
    const tag = decodeURIComponent(match[1])
    return sendHtml(response, 200, renderTag({ tag, posts: await store.list({ tag }), tabs, session }))
  })

  router.get('/blog/feed.atom', async ({ request, response }) => {
    const base = `${origin ?? `http://${request.headers.host ?? 'localhost'}`}/blog/`
    const xml = atomFeed(await store.list(), { title: blogTitle, author: blogAuthor, feedUrl: `${base}feed.atom`, siteUrl: base, absolute: p => `${base}${datedPath(p)}` })
    return sendText(response, 200, xml, 'application/atom+xml; charset=utf-8')
  })

  router.get(new RegExp(`^/blog/(\\d{4}/\\d{2}/\\d{2})/${SLUG}$`), async ({ response, match, session }) => {
    const post = await store.get(match[2])
    if (!post || post.status !== 'published') return send(response, 404, { error: 'No such post' })
    if (datedPath(post) !== `${match[1]}/${match[2]}`) return redirect(response, 301, appPath(post))
    return showPost({ response, post, session })
  })

  router.get(new RegExp(`^/blog/post/${SLUG}(\\.md|\\.json)?$`), async ({ request, response, match, session }) => {
    const post = await visible(match[1], session)
    if (match[2] === '.md') return sendText(response, 200, `# ${post.title}\n\n${post.content}`, 'text/markdown; charset=utf-8')
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, { ...post, href: appPath(post) })
    if (post.status === 'published') return redirect(response, 302, appPath(post))
    return showPost({ response, post, session })
  })

  router.get(new RegExp(`^/blog/post/${SLUG}/edit$`), async ({ response, url, match, session }) => {
    if (!session.user) return redirect(response, 303, `/login?return=${encodeURIComponent(url.pathname)}`)
    const post = await visible(match[1], session)
    return sendHtml(response, 200, renderEdit({ post, posts: await store.list({ drafts: true }), tabs, session }))
  })

  // ── Writes ───────────────────────────────────────────────────────────

  // A new draft: from a title, or from a wiki page / outline item (from=IRI,
  // page path or [[Title]]).
  router.add(['POST'], '/blog/posts', writeRoute(async ({ body, identity }) => {
    let fields = { title: body.title, content: body.content ?? '', tags: body.tags ?? [] }
    if (body.from) {
      const source = toIri(body.from, { registry, origin }) ?? await registry.resolveTitle(String(body.from).replace(/^\[\[|\]\]$/g, ''))
      fields = await draftFrom(source, { wiki, outlines })
    }
    const post = await store.create(fields, identity.user)
    if (post.derivedFrom && services.links) await services.links.add({ from: post.iri, kind: 'related', to: post.derivedFrom, actor: identity.user }).catch(() => {})
    return { redirect: `/blog/post/${post.slug}/edit`, json: { ok: true, slug: post.slug, iri: post.iri } }
  }))

  router.add(['POST'], new RegExp(`^/blog/post/${SLUG}$`), writeRoute(async ({ request, match, body, identity, session }) => {
    const post = await visible(match[1], session)
    const fields = {}
    for (const key of ['title', 'content', 'tags', 'abstract']) if (key in body) fields[key] = body[key]
    const posts = await store.list({ drafts: true })
    if (body.action === 'preview') {
      if (wantsJson(request)) return { json: { ok: true, html: postHtml(String(fields.content ?? post.content), { posts, postHref: appPath }) } }
      return { html: renderEdit({ post, draft: { ...post, ...fields }, posts, preview: true, tabs, session }) }
    }
    const saved = await store.update(post, fields, identity.user)
    return { redirect: appPath(saved), json: { ok: true, slug: saved.slug } }
  }))

  router.add(['POST'], new RegExp(`^/blog/post/${SLUG}/publish$`), writeRoute(async ({ match, body, identity, session }) => {
    const publish = body.publish === true || body.publish === 'true'
    const post = await store.setPublished(await visible(match[1], session), publish, identity.user)
    return { redirect: appPath(post), json: { ok: true, status: post.status, href: appPath(post) } }
  }))

  router.add(['POST'], new RegExp(`^/blog/post/${SLUG}/delete$`), writeRoute(async ({ match, identity, session }) => {
    await store.delete(await visible(match[1], session), identity.user)
    return { redirect: '/blog/', json: { ok: true } }
  }))
}

export default registerRoutes
