/**
 * Topics for things that aren't bookmarks (wiki pages, tasks, outline items,
 * posts, news items): a topic applies when its name — or one of its other
 * spellings — appears in the text as whole words: in the title (first line)
 * it counts twice, in the body once per mention (up to 3). A score of 2 is
 * enough. Each thing keeps its perDoc best topics, the more specific first
 * on a tie. Transparent on purpose: you can see why a page has a topic.
 *
 * docs: [{ iri, text }]; topics: from buildTopics. → Map iri → [topic key]
 */

function pattern (form) {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ -]+/g, '[ -]+')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(e?s)?(?=$|[^\\p{L}\\p{N}])`, 'giu')
}

export function assignByText (docs, topics, { perDoc = 3, minScore = 2 } = {}) {
  const matchers = topics.map(t => ({
    topic: t,
    patterns: [...new Set([t.label, t.key, ...t.altLabels].map(f => String(f).toLowerCase().replace(/[_-]+/g, ' ').trim()).filter(f => f.length >= 2))].map(pattern)
  }))
  const out = new Map()
  for (const doc of docs) {
    const text = String(doc.text ?? '').toLowerCase()
    const newline = text.indexOf('\n')
    const title = newline === -1 ? text : text.slice(0, newline)
    const body = newline === -1 ? '' : text.slice(newline + 1)
    const scored = []
    for (const { topic, patterns } of matchers) {
      let inTitle = false
      let inBody = 0
      for (const p of patterns) {
        if (!inTitle && title.match(p)) inTitle = true
        inBody = Math.max(inBody, Math.min(3, body.match(p)?.length ?? 0))
      }
      const score = (inTitle ? 2 : 0) + inBody
      if (score >= minScore) scored.push({ key: topic.key, score, size: topic.size })
    }
    scored.sort((a, b) => (b.score - a.score) || (a.size - b.size) || a.key.localeCompare(b.key))
    if (scored.length) out.set(doc.iri, scored.slice(0, perDoc).map(s => s.key))
  }
  return out
}

export default assignByText
