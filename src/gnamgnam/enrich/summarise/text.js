import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { tokenise } from '../../../common/search/LexicalIndex.js'

/** Text helpers shared by the summarisers: sentences, key terms, markdown. */

export function splitSentences (text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+["']?/g)?.map(s => s.trim()).filter(Boolean) ?? []
}

const STOPWORDS = new Set(String(
  'a an the and or but if then else when at by for with about into through during ' +
  'before after above below to from up down in out on off over under again further ' +
  'once here there all any both each few more most other some such no nor not only ' +
  'own same so than too very can will just should now is are was were be been being ' +
  'have has had having do does did doing would could ought of as it its this that ' +
  'these those he she they them his her their you your we our us i me my what which ' +
  'who whom how why where because while also per via within without between across ' +
  'among et al may many much every shall must might need used using use often still'
).split(' '))

/**
 * Frequency key terms over lexical-index tokens: stopwords, short and
 * numeric tokens dropped, ties broken by first occurrence. Title text is
 * prepended by callers to weight it (frequency does the rest).
 */
export function extractKeywords (text, { max = 12 } = {}) {
  const counts = new Map()
  const first = new Map()
  let pos = 0
  for (const token of tokenise(text)) {
    pos += 1
    if (token.length < 3 || STOPWORDS.has(token) || /^[0-9]+$/.test(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
    if (!first.has(token)) first.set(token, pos)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || first.get(a[0]) - first.get(b[0]))
    .slice(0, max)
    .map(([term]) => term)
}

export function normaliseKeywords (terms, { max = 12 } = {}) {
  const out = []
  for (const raw of terms ?? []) {
    const term = String(raw ?? '').trim().toLowerCase()
    if (term.length < 2 || out.includes(term)) continue
    out.push(term)
    if (out.length >= max) break
  }
  return out
}

/** Deterministic markdown document for a bookmark summary. */
export function buildMarkdown ({ title, url, summary, keywords = [], types = [], markdownMaxChars = ENRICH_CONFIG.markdownMaxChars } = {}) {
  if (!summary && !title && !url) return null
  let domain = null
  try { domain = new URL(url).hostname } catch { domain = null }
  const lines = [`# ${title || url || 'Untitled'}`, '']
  if (summary) lines.push(summary, '')
  const meta = []
  if (domain) meta.push(`- Source: [${domain}](${url})`)
  else if (url) meta.push(`- Source: ${url}`)
  if (types.length) meta.push(`- Types: ${types.join(', ')}`)
  if (keywords.length) meta.push(`- Key terms: ${keywords.join(', ')}`)
  if (meta.length) lines.push(...meta)
  return lines.join('\n').trim().slice(0, markdownMaxChars) || null
}
