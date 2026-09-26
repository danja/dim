import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import { slugify } from '../common/rdf/URIMinter.js'
import { P, nodeIri, outlineIri, newNodeId, decimalLiteral, outlineTriples, nodeTriples } from './rdf.js'
import { loadOutlines, resourcesOf } from './queries.js'
import { childrenOf, positionBetween, needsRenumber, renumber, insertPlace, planMove, subtree, TreeError } from './tree.js'

/**
 * Outlines in graph:facet/trestle, held in memory (loaded once, on first
 * use) and written through to the store on every change. DIM is single-user,
 * so the cache and the store cannot drift apart except by editing the store
 * behind the server's back — restart the server after an import.
 */

export class OutlineStore {
  constructor ({ client, repository, links = null, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('OutlineStore needs a client and a Repository')
    this.client = client
    this.repository = repository
    this.links = links
    this.queries = queries
    this.now = now
    this.outlines = null // slug → outline
  }

  async graph () {
    return this.repository.facetGraph('trestle', { comment: 'Outlines (Trestle)' })
  }

  // ── Loading ──────────────────────────────────────────────────────────

  async #load () {
    if (this.outlines) return this.outlines
    this.outlines = await loadOutlines(this.client, this.queries, await this.graph())
    return this.outlines
  }

  /** The outline and its nodes as Turtle, straight from the store. */
  async turtle (outline) {
    return this.client.construct(this.queries.get('trestle/describe-outline', { graph: iri(await this.graph()), outline: iri(outline.iri) }))
  }

  /** Forget the cache (after an import from the command line). */
  reset () {
    this.outlines = null
  }

  async list () {
    return [...(await this.#load()).values()]
  }

  async outline (slug) {
    return (await this.#load()).get(slug) ?? null
  }

  /** → { outline, node } | null */
  async find (id) {
    for (const outline of (await this.#load()).values()) {
      const node = outline.nodes.get(id)
      if (node) return { outline, node }
    }
    return null
  }

  async byIri (resourceIri) {
    const outlines = await this.#load()
    for (const outline of outlines.values()) {
      if (outline.iri === resourceIri) return { outline, node: null }
      const id = resourceIri.slice(resourceIri.lastIndexOf('/') + 1)
      const node = outline.nodes.get(id)
      if (node?.iri === resourceIri) return { outline, node }
    }
    return null
  }

  // ── Writing ──────────────────────────────────────────────────────────

  async createOutline ({ title, actor }) {
    const clean = String(title ?? '').trim()
    if (!clean) throw new TreeError('An outline needs a title')
    const outlines = await this.#load()
    let base
    try {
      base = slugify(clean)
    } catch {
      base = 'outline'
    }
    let slug = base
    for (let n = 2; outlines.has(slug); n++) slug = `${base}-${n}`
    const outline = { iri: outlineIri(slug), slug, title: clean, created: this.now().toISOString(), nodes: new Map() }
    await this.repository.add({ graph: await this.graph(), subject: outline.iri, triples: outlineTriples(outline), actor, summary: `outline ${clean}` })
    outlines.set(slug, outline)
    return outline
  }

  /** New node as the last child of `parent` (an IRI), or right after sibling `after` (an id). */
  async createNode (outline, { parent = null, after = null, title = '', actor }) {
    const place = insertPlace(outline, { parent: parent ?? outline.iri, after })
    await this.#makeRoom(outline, place, actor)
    const id = newNodeId()
    const node = {
      id,
      iri: nodeIri(id),
      title: String(title ?? '').trim(),
      parent: place.parent,
      position: positionBetween(place.before, place.after),
      note: null,
      collapsed: false,
      created: this.now().toISOString(),
      modified: null,
      line: null
    }
    await this.repository.add({ graph: await this.graph(), subject: node.iri, triples: nodeTriples({ ...node, outline: outline.iri }), actor, summary: 'new node' })
    outline.nodes.set(id, node)
    return node
  }

  /** Change title, note and/or collapsed. Only the fields given are touched. */
  async updateNode (outline, node, { title, note, collapsed }, actor) {
    const s = iri(node.iri)
    const next = { ...node }
    const predicates = []
    const triples = []
    if (title !== undefined) {
      next.title = String(title).trim()
      predicates.push(P.title)
      triples.push(`${s} ${iri(P.title)} ${literal(next.title)} .`)
    }
    if (note !== undefined) {
      next.note = String(note ?? '').replace(/\r\n/g, '\n').trim() || null
      predicates.push(P.note)
      if (next.note) triples.push(`${s} ${iri(P.note)} ${literal(next.note)} .`)
    }
    if (collapsed !== undefined) {
      next.collapsed = collapsed === true || collapsed === 'true' || collapsed === 'on'
      predicates.push(P.collapsed)
      if (next.collapsed) triples.push(`${s} ${iri(P.collapsed)} ${typedLiteral(true)} .`)
    }
    if (!predicates.length) return node
    if (title !== undefined || note !== undefined) {
      next.modified = this.now().toISOString()
      predicates.push(P.modified)
      triples.push(`${s} ${iri(P.modified)} ${typedLiteral(new Date(next.modified))} .`)
    }
    await this.repository.replace({ graph: await this.graph(), subject: node.iri, predicates, triples, actor, summary: `edit ${predicates.map(p => p.replace(/^.*[/#]/, '')).join(', ')}` })
    Object.assign(node, next)
    return node
  }

  /** indent | outdent | up | down. → the node, moved (or unchanged if the move is impossible). */
  async move (outline, node, op, actor) {
    const plan = planMove(outline, node, op)
    if (!plan) return { node, moved: false }
    await this.#makeRoom(outline, plan, actor)
    const position = positionBetween(plan.before, plan.after)
    const s = iri(node.iri)
    await this.repository.replace({
      graph: await this.graph(),
      subject: node.iri,
      predicates: [P.partOf, P.position],
      triples: [`${s} ${iri(P.partOf)} ${iri(plan.parent)} .`, `${s} ${iri(P.position)} ${decimalLiteral(position)} .`],
      actor,
      summary: `move ${op}`
    })
    node.parent = plan.parent
    node.position = position
    if (plan.expand?.collapsed) await this.updateNode(outline, plan.expand, { collapsed: false }, actor)
    return { node, moved: true }
  }

  /** Delete a node and everything under it, and their links. → ids deleted */
  async deleteNode (outline, node, actor) {
    const doomed = subtree(outline, node)
    const iris = doomed.map(n => n.iri)
    await this.repository.deleteResources({ graph: await this.graph(), subjects: iris, actor, summary: `deleted ${doomed.length} node(s): ${node.title.slice(0, 60)}` })
    if (this.links) await this.links.forget(iris)
    for (const n of doomed) outline.nodes.delete(n.id)
    return doomed.map(n => n.id)
  }

  /**
   * If the gap a new position needs is too small, spread the siblings out
   * (1, 2, 3 …) first and recompute the gap in place.
   */
  async #makeRoom (outline, place, actor) {
    if (!needsRenumber(place.before, place.after)) return
    const siblings = childrenOf(outline, place.parent)
    const graph = await this.graph()
    const moves = renumber(siblings)
    const deletes = moves.map(({ node }) => `${iri(node.iri)} ${iri(P.position)} ?p${node.id} .`).join('\n  ')
    const inserts = moves.map(({ node, position }) => `${iri(node.iri)} ${iri(P.position)} ${decimalLiteral(position)} .`).join('\n  ')
    await this.client.update(`DELETE { GRAPH ${iri(graph)} {\n  ${deletes}\n} }\nINSERT { GRAPH ${iri(graph)} {\n  ${inserts}\n} }\nWHERE { GRAPH ${iri(graph)} {\n  ${deletes}\n} }`)
    await this.repository.changeLog.record({ actor, action: 'update', graph, subject: place.parent, predicates: [P.position], summary: `renumbered ${moves.length} siblings` })
    const oldBefore = place.before
    const oldAfter = place.after
    for (const { node, position } of moves) {
      if (node.position === oldBefore) place.before = position
      if (node.position === oldAfter) place.after = position
      node.position = position
    }
  }

  /** node IRI → [resource IRIs], from the links graph, for a set of nodes. */
  async resourcesOf (nodes) {
    if (!this.links || !nodes.length) return new Map()
    return resourcesOf(this.client, this.queries, await this.links.graph(), nodes)
  }
}

export default OutlineStore
