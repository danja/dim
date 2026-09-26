import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'

/**
 * Auxiliary catalogue details per bookmark type (docs/plan.md: "if the link
 * is a github repo, an arxiv paper etc").
 *
 * Two owners, so a re-run of one never erases the other's triples:
 *   - 'url'    — derived offline from the URL at ingest (catalogueFromUrl).
 *   - 'enrich' — reported by the site API fetchers during enrichment and
 *                replaced on every enrichment patch.
 *
 * One table drives serialisation, the enrichment patch, the SPARQL
 * text view and the detail page, so a new field is added in one place
 * (plus vocabs/dim.ttl, vocabs/shapes.ttl and the text-view query).
 */

const dim = NAMESPACES.dim

export const CATALOGUE_FIELDS = Object.freeze([
  { key: 'githubOwner', label: 'GitHub owner', owner: 'url', type: 'string' },
  { key: 'githubRepo', label: 'GitHub repository', owner: 'url', type: 'string' },
  { key: 'githubLanguage', label: 'Language', owner: 'enrich', type: 'string' },
  { key: 'githubStars', label: 'Stars', owner: 'enrich', type: 'integer' },
  { key: 'githubTopic', label: 'Topics', owner: 'enrich', type: 'string', repeat: true },
  { key: 'arxivId', label: 'arXiv id', owner: 'url', type: 'string' },
  { key: 'arxivAuthor', label: 'Authors', owner: 'enrich', type: 'string', repeat: true },
  { key: 'arxivCategory', label: 'arXiv categories', owner: 'enrich', type: 'string', repeat: true },
  { key: 'wikipediaLanguage', label: 'Wikipedia language', owner: 'url', type: 'string' },
  { key: 'wikipediaTitle', label: 'Wikipedia article', owner: 'url', type: 'string' }
].map(field => Object.freeze({ ...field, predicate: dim + field.key })))

export const ENRICH_CATALOGUE_PREDICATES = Object.freeze(
  CATALOGUE_FIELDS.filter(f => f.owner === 'enrich').map(f => f.predicate)
)

function lastSegment (path) {
  return path.split('/').filter(Boolean)
}

/** Offline, URL-only details. → { key: value } with only the keys that apply. */
export function catalogueFromUrl (rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return {}
  }
  const host = url.hostname.toLowerCase()
  const parts = lastSegment(url.pathname)

  if (host === 'github.com' && parts.length >= 2) {
    return { githubOwner: parts[0], githubRepo: parts[1].replace(/\.git$/, '') }
  }

  if (host === 'arxiv.org' || host.endsWith('.arxiv.org')) {
    const m = url.pathname.match(/^\/(?:abs|pdf|html)\/(.+?)(?:v\d+)?(?:\.pdf)?\/?$/i)
    if (m) return { arxivId: m[1] }
    return {}
  }

  const wiki = host.match(/^([a-z][a-z-]*)\.(?:m\.)?wikipedia\.org$/)
  if (wiki && url.pathname.startsWith('/wiki/') && url.pathname.length > 6) {
    let title = url.pathname.slice(6)
    try { title = decodeURIComponent(title) } catch { /* keep raw */ }
    return { wikipediaLanguage: wiki[1], wikipediaTitle: title.replace(/_/g, ' ') }
  }

  return {}
}

/** Keep only known keys, with values of the right shape. */
export function cleanCatalogue (catalogue, { owner = null } = {}) {
  const out = {}
  for (const field of CATALOGUE_FIELDS) {
    if (owner && field.owner !== owner) continue
    const raw = catalogue?.[field.key]
    if (raw === null || raw === undefined) continue
    if (field.repeat) {
      const values = [...new Set((Array.isArray(raw) ? raw : [raw]).map(v => String(v).trim()).filter(Boolean))]
      if (values.length) out[field.key] = values
    } else if (field.type === 'integer') {
      const n = Number(raw)
      if (Number.isInteger(n) && n >= 0) out[field.key] = n
    } else {
      const s = String(raw).trim()
      if (s) out[field.key] = s
    }
  }
  return out
}

/** Catalogue values as SPARQL triples on a subject IRI. */
export function catalogueTriples (subjectIri, catalogue, { owner = null } = {}) {
  const s = iri(subjectIri)
  const clean = cleanCatalogue(catalogue, { owner })
  const triples = []
  for (const field of CATALOGUE_FIELDS) {
    if (!(field.key in clean)) continue
    const values = field.repeat ? clean[field.key] : [clean[field.key]]
    for (const value of values) {
      const object = field.type === 'integer' ? typedLiteral(value) : literal(value)
      triples.push(`${s} ${iri(field.predicate)} ${object} .`)
    }
  }
  return triples
}

/** Separator used by the text-view GROUP_CONCATs for repeatable fields. */
export const LIST_SEPARATOR = ' | '

/** Text-view row → catalogue object (inverse of the SPARQL projection). */
export function catalogueFromRow (row) {
  const out = {}
  for (const field of CATALOGUE_FIELDS) {
    const value = row[field.key]
    if (value === undefined || value === null || value === '') continue
    if (field.repeat) out[field.key] = String(value).split(LIST_SEPARATOR).filter(Boolean)
    else if (field.type === 'integer') out[field.key] = Number(value)
    else out[field.key] = value
  }
  return out
}

export default CATALOGUE_FIELDS
