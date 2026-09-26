import { randomUUID } from 'crypto'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../common/store/SPARQLHelper.js'

/**
 * Every Getting Things Diced roll as a dim:Roll (a prov:Activity) in
 * graph:system/rolls: the dice, the sum, the task picked, its rank, the
 * policy in force and the size of the list. Later phases (the "what next?"
 * advisor) can learn from which picks were started.
 */

const { dim, prov, rdf } = NAMESPACES

export function rollTriples ({ id, at, actor, dice, sum, picked, rank, policy, listSize }) {
  const s = iri(`${dim}roll/${id}`)
  const t = [
    `${s} ${iri(rdf + 'type')} ${iri(dim + 'Roll')} .`,
    `${s} ${iri(rdf + 'type')} ${iri(prov + 'Activity')} .`,
    `${s} ${iri(prov + 'startedAtTime')} ${typedLiteral(at)} .`,
    `${s} ${iri(prov + 'wasAssociatedWith')} ${literal(actor)} .`,
    `${s} ${iri(dim + 'diceSum')} ${typedLiteral(sum)} .`,
    `${s} ${iri(dim + 'rollPolicy')} ${literal(policy)} .`,
    `${s} ${iri(dim + 'listSize')} ${typedLiteral(listSize)} .`,
    `${s} ${iri(dim + 'rank')} ${typedLiteral(rank)} .`
  ]
  dice.forEach(d => t.push(`${s} ${iri(dim + 'die')} ${typedLiteral(d)} .`))
  if (picked) t.push(`${s} ${iri(dim + 'picked')} ${iri(picked)} .`)
  return t
}

export class RollLog {
  constructor ({ client, registry, now = () => new Date() }) {
    Object.assign(this, { client, registry, now })
    this.graph = null
  }

  async #ensureGraph () {
    if (this.graph) return this.graph
    if (!(await this.registry.isRegistered('system', 'rolls'))) {
      await this.registry.register({ kind: 'system', id: 'rolls', licence: 'personal-data', derivedFrom: `${dim}rolls`, comment: 'Getting Things Diced rolls' })
    }
    this.graph = this.registry.constructor.graphIri('system', 'rolls')
    return this.graph
  }

  async record (roll) {
    const entry = { id: randomUUID(), at: this.now(), ...roll }
    await this.client.update(insertDataQuery(await this.#ensureGraph(), rollTriples(entry)))
    return entry
  }
}

export default RollLog
