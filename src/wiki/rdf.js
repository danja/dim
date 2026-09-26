import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'
import { slugify } from '../common/rdf/URIMinter.js'

/** Wiki page and revision triples (graph:facet/wiki). */

const { dim, rdf, dcterms, prov, sioc } = NAMESPACES

export const P = Object.freeze({
  type: rdf + 'type',
  title: dcterms + 'title',
  content: sioc + 'content',
  created: dcterms + 'created',
  modified: dcterms + 'modified',
  tag: dim + 'tag',
  revisionNumber: dim + 'revisionNumber',
  currentRevision: dim + 'currentRevision',
  revisionOf: dim + 'revisionOf',
  wasRevisionOf: prov + 'wasRevisionOf',
  attributedTo: prov + 'wasAttributedTo'
})

export const PAGE_PREDICATES = Object.freeze([P.type, P.title, P.content, P.created, P.modified, P.tag, P.revisionNumber, P.currentRevision])
export const C = Object.freeze({ WikiPage: dim + 'WikiPage', PageRevision: dim + 'PageRevision' })

export const pageIri = slug => `${dim}page/${slug}`
export const revisionIri = (slug, n) => `${dim}page-revision/${slug}--${n}`

/** A page slug from its title: lower-case words joined by hyphens. */
export function slugForTitle (title) {
  try {
    return slugify(String(title ?? ''))
  } catch {
    return 'page'
  }
}

export function pageTriples (page) {
  const s = iri(page.iri)
  const t = [
    `${s} ${iri(P.type)} ${iri(C.WikiPage)} .`,
    `${s} ${iri(P.title)} ${literal(page.title)} .`,
    `${s} ${iri(P.content)} ${literal(page.content)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(page.created))} .`,
    `${s} ${iri(P.revisionNumber)} ${typedLiteral(page.revision)} .`,
    `${s} ${iri(P.currentRevision)} ${iri(revisionIri(page.slug, page.revision))} .`
  ]
  if (page.modified) t.push(`${s} ${iri(P.modified)} ${typedLiteral(new Date(page.modified))} .`)
  for (const tag of page.tags ?? []) t.push(`${s} ${iri(P.tag)} ${literal(tag)} .`)
  return t
}

export function revisionTriples ({ slug, page, n, title, content, at, actor }) {
  const s = iri(revisionIri(slug, n))
  const t = [
    `${s} ${iri(P.type)} ${iri(C.PageRevision)} .`,
    `${s} ${iri(P.revisionOf)} ${iri(page)} .`,
    `${s} ${iri(P.revisionNumber)} ${typedLiteral(n)} .`,
    `${s} ${iri(P.title)} ${literal(title)} .`,
    `${s} ${iri(P.content)} ${literal(content)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(at))} .`,
    `${s} ${iri(P.attributedTo)} ${literal(actor)} .`
  ]
  if (n > 1) t.push(`${s} ${iri(P.wasRevisionOf)} ${iri(revisionIri(slug, n - 1))} .`)
  return t
}
