import { saveBookmark } from '../gnamgnam/saveBookmark.js'
import { NewsError } from './NewsStore.js'

/**
 * An item → a GnamGnam bookmark or a Farelo task, linked back to the item
 * (which is starred, so it never expires from under the link).
 *
 * A new bookmark goes into graph:facet/gnamgnam (see
 * src/gnamgnam/saveBookmark.js); the route asks GnamGnam to load it, so it
 * is searchable at once, and `node bin/ingest.js --only-new` embeds it.
 */

export async function saveAsBookmark ({ item, feed, text, client, repository, links, news, actor }) {
  if (!item.link) throw new NewsError('This item has no link to bookmark')
  const saved = await saveBookmark({
    url: item.link,
    title: item.title,
    description: text ?? item.snippet ?? null,
    context: `From the feed “${feed?.title ?? 'news'}”`,
    tags: ['news'],
    source: item.iri,
    client,
    repository,
    actor
  })
  if (links) await links.add({ from: item.iri, kind: 'resource', to: saved.iri, actor }).catch(() => {})
  await news.setFlags([item], { starred: true, read: true })
  return saved
}

export async function makeTask ({ item, feed, tasks, links, news, actor }) {
  if (!tasks) throw new NewsError('Tasks (Farelo) are not available', 503)
  const note = [item.link ? `[${item.title}](${item.link})` : item.title, feed ? `From the feed “${feed.title}”.` : ''].filter(Boolean).join('\n\n')
  const task = await tasks.create({ title: item.title.slice(0, 200), note, status: 'todo', tags: ['news'] }, actor)
  if (links) await links.add({ from: task.iri, kind: 'resource', to: item.iri, actor }).catch(() => {})
  await news.setFlags([item], { starred: true, read: true })
  return task
}
