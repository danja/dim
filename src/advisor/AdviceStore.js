import { randomUUID } from 'crypto'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import { DEFAULT_WEIGHTS, FEATURES } from './score.js'

/**
 * Advisor state in graph:facet/advisor: accept/skip feedback (one
 * dim:Advice each) and the learnt weights. Plus the one fact the advisor
 * needs from the links graph: how many resources each task links to.
 */

const { dim, rdf, prov, dcterms } = NAMESPACES
export const WEIGHTS_IRI = `${dim}advisor-weights`
const FEEDBACK_DAYS = 30

export class AdviceStore {
  constructor ({ client, repository, links = null, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('AdviceStore needs a client and a Repository')
    Object.assign(this, { client, repository, links, queries, now })
  }

  async graph () {
    return this.repository.facetGraph('advisor', { comment: 'What-next advisor: feedback and learnt weights' })
  }

  async weights () {
    const [row] = await this.client.select(this.queries.get('advisor/weights', { graph: iri(await this.graph()), subject: iri(WEIGHTS_IRI) }))
    let stored = {}
    try { stored = row ? JSON.parse(row.weights) : {} } catch { stored = {} }
    return Object.fromEntries(FEATURES.map(k => [k, Number.isFinite(stored[k]) ? stored[k] : DEFAULT_WEIGHTS[k]]))
  }

  async saveWeights (weights, actor) {
    const s = iri(WEIGHTS_IRI)
    const triples = [
      `${s} ${iri(dim + 'weights')} ${literal(JSON.stringify(weights))} .`,
      `${s} ${iri(dcterms + 'modified')} ${typedLiteral(this.now())} .`
    ]
    await this.repository.replace({ graph: await this.graph(), subject: WEIGHTS_IRI, predicates: [dim + 'weights', dcterms + 'modified'], triples, actor, summary: 'advisor weights learnt' })
  }

  /** Feedback from the last 30 days, newest first. */
  async feedback () {
    const since = new Date(this.now().getTime() - FEEDBACK_DAYS * 86400000)
    const rows = await this.client.select(this.queries.get('advisor/feedback', { graph: iri(await this.graph()), since: typedLiteral(since) }))
    return rows.map(r => ({ task: r.task, action: r.action, rank: r.rank != null ? Number(r.rank) : null, at: r.at }))
  }

  /** task iri → [iso times it was skipped] */
  async skips () {
    const out = new Map()
    for (const f of await this.feedback()) {
      if (f.action !== 'skip') continue
      if (!out.has(f.task)) out.set(f.task, [])
      out.get(f.task).push(f.at)
    }
    return out
  }

  async record ({ task, action, rank = null }, actor) {
    const subject = `${dim}advice/${randomUUID()}`
    const s = iri(subject)
    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(dim + 'Advice')} .`,
      `${s} ${iri(dim + 'adviceFor')} ${iri(task)} .`,
      `${s} ${iri(dim + 'adviceAction')} ${literal(action)} .`,
      `${s} ${iri(prov + 'startedAtTime')} ${typedLiteral(this.now())} .`
    ]
    if (Number.isInteger(rank) && rank > 0) triples.push(`${s} ${iri(dim + 'adviceRank')} ${typedLiteral(rank)} .`)
    await this.repository.add({ graph: await this.graph(), subject, triples, actor, summary: `${action} suggestion` })
    return subject
  }

  /** iri → number of dim:resource links from it. */
  async resourceCounts () {
    if (!this.links) return new Map()
    const rows = await this.client.select(this.queries.get('advisor/resource-counts', { graph: iri(await this.links.graph()) }))
    return new Map(rows.map(r => [r.s, Number(r.n)]))
  }
}

export default AdviceStore
