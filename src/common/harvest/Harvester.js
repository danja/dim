/**
 * The harvester interface for DIM. Copied from plugin-universe Harvester,
 * generalised: harvest() is implemented per harvester (bookmarks, not plugins).
 * Every harvester declares its graph kind, id and licence up front.
 */

export class HarvestError extends Error {
  constructor (message, { source = null, cause = null } = {}) {
    super(message)
    this.name = 'HarvestError'
    this.source = source
    if (cause) this.cause = cause
  }
}

export class Harvester {
  /**
   * @param {object} spec
   * @param {string} spec.id - stable source id, e.g. 'workflowy'
   * @param {string} spec.kind - a GRAPH_KINDS key
   * @param {string} spec.licence - a LICENCES key. Required.
   * @param {string} spec.derivedFrom - where the data came from
   */
  constructor ({ id, kind, licence, derivedFrom }) {
    for (const [key, value] of Object.entries({ id, kind, licence, derivedFrom })) {
      if (!value) throw new HarvestError(`A harvester must declare ${key}`)
    }
    this.id = id
    this.kind = kind
    this.licence = licence
    this.derivedFrom = derivedFrom
  }

  async collect () {
    throw new HarvestError(`${this.constructor.name} does not implement collect()`)
  }

  async harvest () {
    throw new HarvestError(`${this.constructor.name} does not implement harvest()`)
  }
}

export default Harvester
