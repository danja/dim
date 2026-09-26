import { randomBytes } from 'crypto'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'
import { decimalLiteral } from '../common/store/positions.js'

/** Outline and node triples, IRIs and literals (graph:facet/trestle). */

const { dim, rdf, dcterms } = NAMESPACES

export const P = Object.freeze({
  type: rdf + 'type',
  title: dcterms + 'title',
  created: dcterms + 'created',
  modified: dcterms + 'modified',
  note: dim + 'note',
  inOutline: dim + 'inOutline',
  partOf: dim + 'partOf',
  position: dim + 'position',
  collapsed: dim + 'collapsed',
  sourceLine: dim + 'sourceLine'
})

export const C = Object.freeze({ Outline: dim + 'Outline', OutlineNode: dim + 'OutlineNode' })

export const nodeIri = id => `${dim}node/${id}`
export const outlineIri = slug => `${dim}outline/${slug}`
export const newNodeId = () => `n${randomBytes(6).toString('hex')}`

export { decimalLiteral } from '../common/store/positions.js'

export function outlineTriples ({ iri: o, title, created }) {
  const s = iri(o)
  return [
    `${s} ${iri(P.type)} ${iri(C.Outline)} .`,
    `${s} ${iri(P.title)} ${literal(title)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(created))} .`
  ]
}

export function nodeTriples ({ iri: n, outline, parent, position, title, note = null, collapsed = false, created, modified = null, line = null }) {
  const s = iri(n)
  const triples = [
    `${s} ${iri(P.type)} ${iri(C.OutlineNode)} .`,
    `${s} ${iri(P.title)} ${literal(title ?? '')} .`,
    `${s} ${iri(P.inOutline)} ${iri(outline)} .`,
    `${s} ${iri(P.partOf)} ${iri(parent)} .`,
    `${s} ${iri(P.position)} ${decimalLiteral(position)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(created))} .`
  ]
  if (modified) triples.push(`${s} ${iri(P.modified)} ${typedLiteral(new Date(modified))} .`)
  if (note) triples.push(`${s} ${iri(P.note)} ${literal(note)} .`)
  if (collapsed) triples.push(`${s} ${iri(P.collapsed)} ${typedLiteral(true)} .`)
  if (line != null) triples.push(`${s} ${iri(P.sourceLine)} ${typedLiteral(line)} .`)
  return triples
}
