import { parseHashtags } from './parse.js'

/**
 * Read #hashtags from text that was saved before hashtags existed.
 * items: [{ iri, texts: [markdown…] }]. Only items that contain a tag are
 * synced (saving does this per item; this is the same call in bulk).
 * → { items, tagged, tags: Map tag → uses }
 */
export async function backfillHashtags (items, links, { actor = 'backfill', dryRun = false, onProgress = () => {} } = {}) {
  const tags = new Map()
  let tagged = 0
  let n = 0
  for (const item of items) {
    onProgress(++n)
    const found = parseHashtags(...item.texts.filter(Boolean))
    if (!found.length) continue
    tagged++
    for (const tag of found) tags.set(tag, (tags.get(tag) ?? 0) + 1)
    if (!dryRun) await links.syncHashtags({ from: item.iri, tags: found, actor })
  }
  return { items: n, tagged, tags }
}

export default backfillHashtags
