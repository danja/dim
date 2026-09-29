import { slugify } from '../rdf/URIMinter.js'

/**
 * Topics for bookmarks, from what enrichment and the sites said about them:
 * LLM keywords, GitHub topics, arXiv categories, and your own tags. Pure and
 * deterministic, so a run can be reviewed (bin/topics.js --dry-run) before
 * it's written.
 *
 *  1. Normalise each term: lower case, "-"/"_" → space, arXiv codes named
 *     ("cs.AI" → "artificial intelligence"); a plural joins its singular
 *     when both occur ("graphs" + "graph"), so "node.js" and "kubernetes"
 *     stay as they are.
 *  2. Candidate topics are terms on at least minDocs bookmarks and at most
 *     maxShare of them (a term on everything says nothing).
 *  3. Keep the maxTopics most used; the label is the most common spelling,
 *     the other spellings become alternative labels.
 *  4. A topic is narrower than another when ≥ 80% of its bookmarks are in
 *     the other, which has at least 1.5× as many (skos:broader).
 *  5. Each bookmark gets its perBookmark most specific topics (fewest
 *     bookmarks first).
 */

// Null prototype: a term like "constructor" mustn't find Object's methods.
export const ARXIV_NAMES = Object.freeze({
  __proto__: null,
  'cs.ai': 'artificial intelligence',
  'cs.cl': 'natural language processing',
  'cs.lg': 'machine learning',
  'stat.ml': 'machine learning',
  'cs.cv': 'computer vision',
  'cs.ir': 'information retrieval',
  'cs.db': 'databases',
  'cs.se': 'software engineering',
  'cs.pl': 'programming languages',
  'cs.hc': 'human computer interaction',
  'cs.ne': 'neural networks',
  'cs.ro': 'robotics',
  'cs.lo': 'logic',
  'cs.ma': 'multi agent systems',
  'cs.sd': 'sound',
  'eess.as': 'audio',
  'cs.dl': 'digital libraries',
  'cs.cy': 'computers and society',
  'q-bio.nc': 'neuroscience'
})

export const DEFAULTS = Object.freeze({ minDocs: 8, maxShare: 0.25, maxTopics: 80, perBookmark: 3, containment: 0.8, sizeRatio: 1.5 })

const STOP = new Set(['github', 'repository', 'project', 'tool', 'tools', 'library', 'code', 'software', 'website', 'web page', 'page', 'article', 'blog', 'post', 'news', 'open source', 'free', 'online', 'guide', 'tutorial', 'introduction', 'overview', 'documentation', 'squirt'])

// Hostnames (the source's tags are often the domain, which has its own facet).
const DOMAIN = /^([a-z0-9-]+\.)+(com|org|net|io|co|uk|edu|dev|ai|app|info|gov|de|fr|it|eu|me|tv|us|ca|au|nl|ch)$/

/** The singular a plural key could be ("graphs" → "graph", "ontologies" → "ontology"). */
function singularOf (key) {
  const m = key.match(/^(.*?)([a-z]+)$/)
  if (!m || m[2].length <= 3 || /(ss|us|is)$/.test(m[2])) return null
  if (m[2].endsWith('ies')) return `${m[1]}${m[2].slice(0, -3)}y`
  return m[2].endsWith('s') ? `${m[1]}${m[2].slice(0, -1)}` : null
}

/** A term's canonical key, or null when it isn't a usable topic. */
export function termKey (raw) {
  let t = String(raw ?? '').trim().toLowerCase()
  if (ARXIV_NAMES[t]) t = ARXIV_NAMES[t]
  t = t.replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N}+#. ]+/gu, ' ').replace(/\s+/g, ' ').trim()
  if (t.length < 2 || t.length > 40 || /^\d+$/.test(t) || STOP.has(t) || DOMAIN.test(t)) return null
  return t
}

/**
 * docs: [{ iri, terms: [string] }] → { topics, assignments: Map iri → [topic key] }
 * options.exclude: terms never to make topics of (e.g. every bookmark's domain).
 */
export function buildTopics (docs, options = {}) {
  const o = { ...DEFAULTS, ...options }
  const exclude = new Set([...(o.exclude ?? [])].map(t => String(t).toLowerCase()))
  const members = new Map() // key → Set(iri)
  const spellings = new Map() // key → Map(surface → count)
  const merged = new Map() // plural key → singular key
  for (const doc of docs) {
    for (const raw of doc.terms ?? []) {
      const key = termKey(raw)
      if (!key || exclude.has(key)) continue
      if (!members.has(key)) { members.set(key, new Set()); spellings.set(key, new Map()) }
      members.get(key).add(doc.iri)
      const surface = (ARXIV_NAMES[String(raw).trim().toLowerCase()] ?? String(raw).trim().toLowerCase()).replace(/_/g, '-')
      spellings.get(key).set(surface, (spellings.get(key).get(surface) ?? 0) + 1)
    }
  }
  // Plurals join their singular, when the singular is used too.
  for (const key of [...members.keys()]) {
    const one = singularOf(key)
    if (!one || !members.has(one)) continue
    for (const iri of members.get(key)) members.get(one).add(iri)
    for (const [form, n] of spellings.get(key)) spellings.get(one).set(form, (spellings.get(one).get(form) ?? 0) + n)
    members.delete(key)
    spellings.delete(key)
    merged.set(key, one)
  }
  const cap = Math.max(o.minDocs, Math.floor((o.total ?? docs.length) * o.maxShare))
  const kept = [...members]
    .filter(([, set]) => set.size >= o.minDocs && set.size <= cap)
    .sort(([ka, a], [kb, b]) => (b.size - a.size) || ka.localeCompare(kb))
    .slice(0, o.maxTopics)

  const topics = kept.map(([key, set]) => {
    const forms = [...spellings.get(key)].sort(([sa, a], [sb, b]) => (b - a) || sa.localeCompare(sb)).map(([s]) => s)
    let slug
    try { slug = slugify(key) } catch { slug = null }
    return { key, slug, label: forms[0], altLabels: forms.slice(1, 6), size: set.size, members: set, broader: null }
  }).filter(t => t.slug)

  // One broader topic each: the smallest that contains most of it.
  for (const narrow of topics) {
    let best = null
    for (const wide of topics) {
      if (wide === narrow || wide.size < narrow.size * o.sizeRatio) continue
      let shared = 0
      for (const iri of narrow.members) if (wide.members.has(iri)) shared++
      if (shared / narrow.size >= o.containment && (!best || wide.size < best.size)) best = wide
    }
    narrow.broader = best?.key ?? null
  }

  const byKey = new Map(topics.map(t => [t.key, t]))
  const assignments = new Map()
  for (const doc of docs) {
    const keys = [...new Set((doc.terms ?? []).map(termKey).map(k => merged.get(k) ?? k).filter(k => byKey.has(k)))]
      .sort((a, b) => (byKey.get(a).size - byKey.get(b).size) || a.localeCompare(b))
      .slice(0, o.perBookmark)
    if (keys.length) assignments.set(doc.iri, keys)
  }
  return { topics, assignments }
}
