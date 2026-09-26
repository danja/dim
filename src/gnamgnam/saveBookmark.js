import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri } from '../common/store/SPARQLHelper.js'
import URIMinter from '../common/rdf/URIMinter.js'
import { normaliseBookmark } from './harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from './harvest/BookmarkSerialiser.js'

/**
 * A bookmark made from inside DIM (saved from News, captured in Squirt):
 * written to graph:facet/gnamgnam, which an ingest never drops. If the URL
 * is already bookmarked anywhere, nothing is written. → { iri, created }
 *
 * source: the IRI it came from (dcterms:source), e.g. a news item.
 */

const { dim, dcterms } = NAMESPACES
const minter = new URIMinter()

export async function saveBookmark ({ url, title = null, description = null, tags = [], context = null, source = null, client, repository, actor }) {
  const bookmarkIri = minter.mintBookmark({ url })
  if (await client.ask(`ASK { GRAPH ?g { ${iri(bookmarkIri)} a ${iri(dim + 'Bookmark')} } }`)) return { iri: bookmarkIri, created: false }
  const bookmark = normaliseBookmark({ url, linkText: title, title, description, context, tags })
  const triples = serialiseBookmark(bookmark, bookmarkIri).filter(t => !t.includes(`<${dcterms}source>`))
  if (source) triples.push(`${iri(bookmarkIri)} ${iri(dcterms + 'source')} ${iri(source)} .`)
  await repository.add({ graph: await repository.facetGraph('gnamgnam'), subject: bookmarkIri, triples, actor, summary: `bookmark saved: ${(title ?? url).slice(0, 60)}` })
  return { iri: bookmarkIri, created: true }
}

export default saveBookmark
