import { NAMESPACES } from '../../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../../common/store/SPARQLHelper.js'
import { catalogueTriples } from '../Catalogue.js'

/**
 * Normalised bookmark records to triples.
 * One bookmark per URL; blank nodes are not used — every statement hangs off
 * the bookmark IRI, so groups stay trivially intact across INSERT batches.
 */

const dim = NAMESPACES.dim
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const dcterms = NAMESPACES.dcterms
const schema = NAMESPACES.schema
const skos = NAMESPACES.skos

export function serialiseBookmark (bookmark, bookmarkIri) {
  const s = iri(bookmarkIri)
  const triples = []
  const add = (predicate, object) => {
    if (object === null || object === undefined) return
    triples.push(`${s} ${iri(predicate)} ${object} .`)
  }

  triples.push(`${s} ${iri(rdf + 'type')} ${iri(dim + 'Bookmark')} .`)
  add(rdfs + 'label', literal(bookmark.linkText || bookmark.title || bookmark.url))
  add(dim + 'url', iri(bookmark.url))
  add(schema + 'url', iri(bookmark.url))
  if (bookmark.linkText) add(dim + 'linkText', literal(bookmark.linkText))
  if (bookmark.title) add(dcterms + 'title', literal(bookmark.title))
  if (bookmark.description) add(dcterms + 'description', literal(bookmark.description))
  if (bookmark.summary) add(dim + 'summary', literal(bookmark.summary))
  for (const kw of bookmark.keywords ?? []) add(dim + 'keyword', literal(kw))
  if (bookmark.markdown) add(dim + 'summaryMarkdown', literal(bookmark.markdown))
  if (bookmark.summaryModel) add(dim + 'summaryModel', literal(bookmark.summaryModel))
  if (bookmark.summarisedAt) add(dim + 'summarisedAt', typedLiteral(new Date(bookmark.summarisedAt)))
  if (bookmark.contentHash) add(dim + 'contentHash', literal(bookmark.contentHash))
  if (typeof bookmark.contentLength === 'number') add(dim + 'contentLength', typedLiteral(bookmark.contentLength))
  if (typeof bookmark.fetchStatus === 'number') add(dim + 'fetchStatus', typedLiteral(bookmark.fetchStatus))
  if (bookmark.contentType) add(dim + 'contentType', literal(bookmark.contentType))
  if (typeof bookmark.httpStatus === 'number') add(dim + 'httpStatus', typedLiteral(bookmark.httpStatus))
  if (bookmark.retrievedAt) add(dim + 'retrievedAt', typedLiteral(new Date(bookmark.retrievedAt)))
  if (bookmark.domain) add(dim + 'domain', literal(bookmark.domain))
  if (bookmark.context) add(dim + 'context', literal(bookmark.context))
  if (bookmark.sourceLine != null) add(dim + 'sourceLine', typedLiteral(bookmark.sourceLine))
  add(dcterms + 'source', iri('file:///data/workflowy.md'))

  for (const t of bookmark.bookmarkTypes ?? []) add(dim + 'bookmarkType', iri(t))
  for (const tag of bookmark.tags ?? []) add(dim + 'tag', literal(tag))
  for (const concept of bookmark.concepts ?? []) add(dcterms + 'subject', iri(concept))
  triples.push(...catalogueTriples(bookmarkIri, bookmark.catalogue ?? {}))

  return triples
}

/** SKOS concept scheme for bookmark types + auxiliary concepts. */
export function serialiseBookmarkTypeScheme (types) {
  const scheme = `${dim}bookmark-types`
  const triples = [
    `${iri(scheme)} ${iri(rdf + 'type')} ${iri(skos + 'ConceptScheme')} .`,
    `${iri(scheme)} ${iri(rdfs + 'label')} ${literal('DIM bookmark types')} .`
  ]
  const broader = {
    'github-repo': 'code',
    'github-file': 'code',
    'arxiv-paper': 'paper',
    paper: 'reading',
    'wikipedia-article': 'reference',
    docs: 'reference',
    video: 'media',
    audio: 'media',
    shop: 'product',
    forum: 'discussion',
    blog: 'reading'
  }
  const closed = new Set(types)
  for (const t of types) {
    let parent = broader[t]
    while (parent && !closed.has(parent)) {
      closed.add(parent)
      parent = broader[parent]
    }
  }
  for (const t of [...closed].sort()) {
    const concept = `${dim}concept/${t}`
    triples.push(`${iri(concept)} ${iri(rdf + 'type')} ${iri(skos + 'Concept')} .`)
    triples.push(`${iri(concept)} ${iri(skos + 'inScheme')} ${iri(scheme)} .`)
    triples.push(`${iri(concept)} ${iri(skos + 'prefLabel')} ${literal(t)} .`)
    if (broader[t]) {
      triples.push(`${iri(concept)} ${iri(skos + 'broader')} ${iri(`${dim}concept/${broader[t]}`)} .`)
    }
  }
  return triples
}

export default serialiseBookmark
