import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'

/** Appointments as triples (graph:facet/calendar). IRI: dim:event/<slug>. */

const { dim, rdf, dcterms, xsd } = NAMESPACES

export const P = Object.freeze({
  type: rdf + 'type',
  title: dcterms + 'title',
  notes: dcterms + 'description',
  slug: dim + 'slug',
  date: dim + 'eventDate',
  time: dim + 'eventTime',
  location: dim + 'location',
  created: dcterms + 'created',
  modified: dcterms + 'modified'
})
export const C = Object.freeze({ Event: dim + 'Event' })
export const EVENT_PREDICATES = Object.freeze(Object.values(P))

export const eventIri = slug => `${dim}event/${slug}`

export function eventTriples (event) {
  const s = iri(event.iri)
  const t = [
    `${s} ${iri(P.type)} ${iri(C.Event)} .`,
    `${s} ${iri(P.title)} ${literal(event.title)} .`,
    `${s} ${iri(P.slug)} ${literal(event.slug)} .`,
    `${s} ${iri(P.date)} ${literal(event.date, { datatype: xsd + 'date' })} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(event.created))} .`
  ]
  if (event.time) t.push(`${s} ${iri(P.time)} ${literal(event.time)} .`)
  if (event.location) t.push(`${s} ${iri(P.location)} ${literal(event.location)} .`)
  if (event.notes) t.push(`${s} ${iri(P.notes)} ${literal(event.notes)} .`)
  if (event.modified) t.push(`${s} ${iri(P.modified)} ${typedLiteral(new Date(event.modified))} .`)
  return t
}
