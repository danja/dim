import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri } from '../common/store/SPARQLHelper.js'
import URIMinter from '../common/rdf/URIMinter.js'
import { normaliseBookmark } from '../gnamgnam/harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from '../gnamgnam/harvest/BookmarkSerialiser.js'
import { NewsError } from './NewsStore.js'

/**
 * An item → a GnamGnam bookmark or a Farelo task, linked back to the item
 * (which is starred, so it never expires from under the link).
 *
 * A new bookmark goes into graph:facet/gnamgnam (never dropped by an
 * ingest); it shows in GnamGnam search after a server restart and gets a
 * vector with `node bin/ingest.js --only-new`.
 */

const { dim, dcterms } = NAMESPACES
const minter = new URIMinter()

export async function saveAsBookmark ({ item, feed, text, client, repository, links, news, actor }) {
  if (!item.link) throw new NewsError('This item has no link to bookmark')
  const bookmarkIri = minter.mintBookmark({ url: item.link })
  const exists = await client.ask(`ASK { GRAPH ?g { ${iri(bookmarkIri)} a ${iri(dim + 'Bookmark')} } }`)
  if (!exists) {
    const bookmark = normaliseBookmark({
      url: item.link,
      linkText: item.title,
      title: item.title,
      description: text ?? item.snippet ?? null,
      context: `From the feed “${feed?.title ?? 'news'}”`,
      tags: ['news']
    })
    const triples = serialiseBookmark(bookmark, bookmarkIri)
      .filter(t => !t.includes(`<${dcterms}source>`))
      .concat(`${iri(bookmarkIri)} ${iri(dcterms + 'source')} ${iri(item.iri)} .`)
    await repository.add({ graph: await repository.facetGraph('gnamgnam'), subject: bookmarkIri, triples, actor, summary: 'bookmark saved from news' })
  }
  if (links) await links.add({ from: item.iri, kind: 'resource', to: bookmarkIri, actor }).catch(() => {})
  await news.setFlags([item], { starred: true, read: true })
  return { iri: bookmarkIri, created: !exists }
}

export async function makeTask ({ item, feed, tasks, links, news, actor }) {
  if (!tasks) throw new NewsError('Tasks (Farelo) are not available', 503)
  const note = [item.link ? `[${item.title}](${item.link})` : item.title, feed ? `From the feed “${feed.title}”.` : ''].filter(Boolean).join('\n\n')
  const task = await tasks.create({ title: item.title.slice(0, 200), note, status: 'todo', tags: ['news'] }, actor)
  if (links) await links.add({ from: task.iri, kind: 'resource', to: item.iri, actor }).catch(() => {})
  await news.setFlags([item], { starred: true, read: true })
  return task
}
