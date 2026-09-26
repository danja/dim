import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'

/** Blog posts as triples (graph:facet/blog). IRI: dim:post/<slug>. */

const { dim, rdf, dcterms, prov, sioc } = NAMESPACES

export const P = Object.freeze({
  type: rdf + 'type',
  title: dcterms + 'title',
  content: sioc + 'content',
  abstract: dcterms + 'abstract',
  slug: dim + 'slug',
  status: dim + 'postStatus',
  issued: dcterms + 'issued',
  created: dcterms + 'created',
  modified: dcterms + 'modified',
  tag: dim + 'tag',
  derivedFrom: prov + 'wasDerivedFrom'
})
export const C = Object.freeze({ BlogPost: dim + 'BlogPost' })
export const POST_PREDICATES = Object.freeze(Object.values(P))

export const postIri = slug => `${dim}post/${slug}`

export function postTriples (post) {
  const s = iri(post.iri)
  const t = [
    `${s} ${iri(P.type)} ${iri(C.BlogPost)} .`,
    `${s} ${iri(P.title)} ${literal(post.title)} .`,
    `${s} ${iri(P.content)} ${literal(post.content)} .`,
    `${s} ${iri(P.slug)} ${literal(post.slug)} .`,
    `${s} ${iri(P.status)} ${literal(post.status)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(post.created))} .`
  ]
  if (post.issued) t.push(`${s} ${iri(P.issued)} ${typedLiteral(new Date(post.issued))} .`)
  if (post.modified) t.push(`${s} ${iri(P.modified)} ${typedLiteral(new Date(post.modified))} .`)
  if (post.abstract) t.push(`${s} ${iri(P.abstract)} ${literal(post.abstract)} .`)
  if (post.derivedFrom) t.push(`${s} ${iri(P.derivedFrom)} ${iri(post.derivedFrom)} .`)
  for (const tag of post.tags ?? []) t.push(`${s} ${iri(P.tag)} ${literal(tag)} .`)
  return t
}
