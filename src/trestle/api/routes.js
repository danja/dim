import { send, sendText, sendHtml, redirect } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { renderIndex, renderOutlinePage, renderNodePage, outlinePath } from './pages.js'
import { visibleNodes, titleHtml, nodePath, renderTree } from './treeView.js'
import { ancestors, childrenOf, toMarkdown } from '../tree.js'
import { resolveMentions } from '../../common/links/mentions.js'

/** Trestle HTTP routes, mounted at /trestle. */

const ID = '([a-z0-9]+)'

function notFound (what) {
  return Object.assign(new Error(`No such ${what}`), { status: 404 })
}

/** What the outliner script needs about a node after a change. */
export function nodeJson (outline, node) {
  return {
    id: node.id,
    iri: node.iri,
    title: node.title,
    titleHtml: titleHtml(node),
    note: node.note,
    parent: node.parent,
    position: node.position,
    collapsed: node.collapsed,
    children: childrenOf(outline, node.iri).length,
    href: nodePath(node)
  }
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
  const treeCtx = async (outline, parentIri) => ({
    resources: await store.resourcesOf(visibleNodes(outline, parentIri)),
    registryHref: target => registry.href(target)
  })
  const located = async id => {
    const found = await store.find(id)
    if (!found) throw notFound('item')
    return found
  }

  router.get('/trestle', async ({ response, session }) =>
    sendHtml(response, 200, renderIndex({ outlines: await store.list(), tabs, session })))

  router.get(/^\/trestle\/outline\/([a-z0-9-]+?)(\.md|\.ttl)?$/, async ({ response, match, session }) => {
    const outline = await store.outline(match[1])
    if (!outline) return send(response, 404, { error: 'No such outline', slug: match[1] })
    if (match[2] === '.ttl') return sendText(response, 200, await store.turtle(outline), 'text/turtle; charset=utf-8')
    if (match[2]) return sendText(response, 200, `# ${outline.title}\n\n${toMarkdown(outline, outline.iri)}`, 'text/markdown; charset=utf-8')
    return sendHtml(response, 200, renderOutlinePage({ outline, tabs, session, treeCtx: await treeCtx(outline, outline.iri) }))
  })

  router.get(new RegExp(`^/trestle/node/${ID}(\\.md|\\.json)?$`), async ({ request, response, match, session }) => {
    const found = await store.find(match[1])
    if (!found) return send(response, 404, { error: 'No such item', id: match[1] })
    const { outline, node } = found
    if (match[2] === '.md') return sendText(response, 200, `- ${node.title}\n${toMarkdown(outline, node.iri, 1)}`, 'text/markdown; charset=utf-8')
    if (negotiate(match[2], request.headers.accept) !== 'html') {
      return send(response, 200, { ...nodeJson(outline, node), outline: outline.slug, childNodes: childrenOf(outline, node.iri).map(n => nodeJson(outline, n)) })
    }
    return sendHtml(response, 200, renderNodePage({
      outline,
      node,
      crumbs: ancestors(outline, node),
      tabs,
      session,
      treeCtx: await treeCtx(outline, node.iri),
      links: await linksFor({ services, registry }, node.iri)
    }))
  })

  // The visible tree as an HTML fragment, for the outliner script to swap in
  // after a structural change. ?outline=<slug>&parent=<node id, or empty>
  router.get('/trestle/tree', async ({ response, url, session }) => {
    const outline = await store.outline(url.searchParams.get('outline') ?? '')
    if (!outline) return send(response, 404, { error: 'No such outline' })
    const parentId = url.searchParams.get('parent')
    const parentIri = parentId ? (await located(parentId)).node.iri : outline.iri
    const returnPath = parentId ? nodePath({ id: parentId }) : outlinePath(outline)
    return sendHtml(response, 200, renderTree(outline, parentIri, { ...(await treeCtx(outline, parentIri)), session, returnPath }))
  })

  // ── Writes ───────────────────────────────────────────────────────────

  router.add(['POST'], '/trestle/outlines', writeRoute(async ({ body, identity }) => {
    const outline = await store.createOutline({ title: body.title, actor: identity.user })
    return { redirect: outlinePath(outline), json: { ok: true, slug: outline.slug, iri: outline.iri } }
  }))

  router.add(['POST'], '/trestle/nodes', writeRoute(async ({ body, identity }) => {
    let outline
    let parent = null
    if (body.after) {
      outline = (await located(String(body.after))).outline
    } else if (body.parent) {
      const found = await located(String(body.parent))
      outline = found.outline
      parent = found.node.iri
      if (found.node.collapsed) await store.updateNode(outline, found.node, { collapsed: false }, identity.user)
    } else {
      outline = await store.outline(String(body.outline ?? ''))
      if (!outline) throw notFound('outline')
    }
    const node = await store.createNode(outline, { parent, after: body.after ? String(body.after) : null, title: body.title ?? '', actor: identity.user })
    const back = parent ? nodePath({ id: body.parent }) : outlinePath(outline)
    return { redirect: back, json: { ok: true, node: nodeJson(outline, node) } }
  }))

  router.add(['POST'], new RegExp(`^/trestle/node/${ID}$`), writeRoute(async ({ match, body, identity }) => {
    const { outline, node } = await located(match[1])
    const fields = {}
    for (const key of ['title', 'note', 'collapsed']) if (key in body) fields[key] = body[key]
    await store.updateNode(outline, node, fields, identity.user)
    if ('note' in fields && services.links) {
      const targets = await resolveMentions(node.note ?? '', { registry, origin })
      await services.links.syncMentions({ from: node.iri, targets, actor: identity.user })
    }
    return { redirect: nodePath(node), json: { ok: true, node: nodeJson(outline, node) } }
  }))

  router.add(['POST'], new RegExp(`^/trestle/node/${ID}/move$`), writeRoute(async ({ match, body, identity }) => {
    const { outline, node } = await located(match[1])
    const { moved } = await store.move(outline, node, String(body.op ?? ''), identity.user)
    return { redirect: nodePath(node), json: { ok: true, moved, node: nodeJson(outline, node) } }
  }))

  router.add(['POST'], new RegExp(`^/trestle/node/${ID}/delete$`), writeRoute(async ({ match, identity }) => {
    const { outline, node } = await located(match[1])
    const parent = [...outline.nodes.values()].find(n => n.iri === node.parent)
    const deleted = await store.deleteNode(outline, node, identity.user)
    return { redirect: parent ? nodePath(parent) : outlinePath(outline), json: { ok: true, deleted } }
  }))

  router.get('/trestle/outlines', ({ response }) => redirect(response, 301, '/trestle/'))
}

export default registerRoutes
