import namespace from '@rdfjs/namespace'

/**
 * The single registry of namespace IRIs for DIM.
 * Copied from plugin-universe NamespaceManager, with pu: replaced by dim:.
 * Nothing else in the codebase declares a namespace IRI.
 */
export const NAMESPACES = Object.freeze({
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',

  dim: 'http://purl.org/stuff/dim/',
  schema: 'https://schema.org/',
  doap: 'http://usefulinc.com/ns/doap#',
  foaf: 'http://xmlns.com/foaf/0.1/',

  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  spdx: 'http://spdx.org/rdf/terms#',
  sh: 'http://www.w3.org/ns/shacl#'
})

export class NamespaceManager {
  constructor () {
    for (const [prefix, iri] of Object.entries(NAMESPACES)) {
      this[prefix] = namespace(iri)
    }
  }

  sparqlPrefixes () {
    return Object.entries(NAMESPACES)
      .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
      .join('\n')
  }

  turtlePrefixes () {
    return Object.entries(NAMESPACES)
      .map(([prefix, iri]) => `@prefix ${prefix}: <${iri}> .`)
      .join('\n')
  }

  shrink (iri) {
    for (const [prefix, base] of Object.entries(NAMESPACES)) {
      if (iri.startsWith(base)) return `${prefix}:${iri.slice(base.length)}`
    }
    return iri
  }

  expand (curie) {
    const colon = curie.indexOf(':')
    if (colon === -1) throw new Error(`Not a CURIE: ${curie}`)
    const prefix = curie.slice(0, colon)
    if (!(prefix in NAMESPACES)) throw new Error(`Unregistered prefix: ${prefix}`)
    return NAMESPACES[prefix] + curie.slice(colon + 1)
  }
}

export default NamespaceManager
