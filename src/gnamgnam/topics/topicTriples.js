import { NAMESPACES } from '../../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../../common/store/SPARQLHelper.js'

/** The topic scheme (graph:alignment/bookmark-topics) as triple groups. */

const { dim, rdf, rdfs, skos, dcterms } = NAMESPACES
export const TOPIC_SCHEME = `${dim}bookmark-topics`
export const topicIri = slug => `${dim}concept/topic-${slug}`

export function topicTriples ({ topics, assignments }, { now = new Date() } = {}) {
  const scheme = iri(TOPIC_SCHEME)
  const bySlug = new Map(topics.map(t => [t.key, t]))
  const groups = [[
    `${scheme} ${iri(rdf + 'type')} ${iri(skos + 'ConceptScheme')} .`,
    `${scheme} ${iri(rdfs + 'label')} ${literal('DIM bookmark topics')} .`,
    `${scheme} ${iri(dcterms + 'created')} ${typedLiteral(now)} .`
  ]]
  for (const t of topics) {
    const c = iri(topicIri(t.slug))
    const g = [
      `${c} ${iri(rdf + 'type')} ${iri(skos + 'Concept')} .`,
      `${c} ${iri(skos + 'inScheme')} ${scheme} .`,
      `${c} ${iri(skos + 'prefLabel')} ${literal(t.label)} .`
    ]
    for (const alt of t.altLabels) g.push(`${c} ${iri(skos + 'altLabel')} ${literal(alt)} .`)
    if (t.broader) g.push(`${c} ${iri(skos + 'broader')} ${iri(topicIri(bySlug.get(t.broader).slug))} .`)
    else g.push(`${scheme} ${iri(skos + 'hasTopConcept')} ${c} .`)
    groups.push(g)
  }
  for (const [bookmark, keys] of assignments) {
    groups.push(keys.map(k => `${iri(bookmark)} ${iri(dcterms + 'subject')} ${iri(topicIri(bySlug.get(k).slug))} .`))
  }
  return groups
}
