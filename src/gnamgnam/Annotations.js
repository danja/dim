import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal } from '../common/store/SPARQLHelper.js'
import { resolveMentions } from '../common/links/mentions.js'

/**
 * The owner's own tags and note on a bookmark. Stored in graph:facet/gnamgnam
 * (never in the source graph an ingest reloads); the note's [[references]]
 * become dim:mentions links.
 */

const { dim } = NAMESPACES

export const TAG_PREDICATE = dim + 'tag'
export const NOTE_PREDICATE = dim + 'note'
export const MAX_TAGS = 20
export const MAX_TAG_LENGTH = 60
export const MAX_NOTE_LENGTH = 20000

export class AnnotationError extends Error {
  constructor (message) {
    super(message)
    this.name = 'AnnotationError'
    this.status = 400
  }
}

/** "Synth, DIY,,  eurorack " or an array → ['synth', 'diy', 'eurorack'] */
export function normaliseTags (input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',')
  const tags = []
  for (const value of raw) {
    const tag = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
    if (!tag || tags.includes(tag)) continue
    if (tag.length > MAX_TAG_LENGTH) throw new AnnotationError(`Tag too long (max ${MAX_TAG_LENGTH}): ${tag.slice(0, 30)}…`)
    tags.push(tag)
  }
  if (tags.length > MAX_TAGS) throw new AnnotationError(`At most ${MAX_TAGS} tags`)
  return tags
}

export function normaliseNote (input) {
  const note = String(input ?? '').replace(/\r\n/g, '\n').trim()
  if (note.length > MAX_NOTE_LENGTH) throw new AnnotationError(`Note too long (max ${MAX_NOTE_LENGTH} characters)`)
  return note || null
}

export function annotationTriples (subject, { tags, note }) {
  const s = iri(subject)
  const triples = tags.map(tag => `${s} ${iri(TAG_PREDICATE)} ${literal(tag)} .`)
  if (note) triples.push(`${s} ${iri(NOTE_PREDICATE)} ${literal(note)} .`)
  return triples
}

/**
 * Replace a bookmark's tags and note, sync its mentions, and update the
 * in-memory document so search sees the change at once.
 */
export async function saveAnnotations ({ search, repository, links, registry, origin, doc, tags: rawTags, note: rawNote, actor }) {
  const tags = normaliseTags(rawTags)
  const note = normaliseNote(rawNote)
  const graph = await repository.facetGraph('gnamgnam', { comment: 'Notes and tags on bookmarks' })
  await repository.replace({
    graph,
    subject: doc.iri,
    predicates: [TAG_PREDICATE, NOTE_PREDICATE],
    triples: annotationTriples(doc.iri, { tags, note }),
    actor,
    summary: `tags: ${tags.join(', ') || '(none)'}; note: ${note ? `${note.length} chars` : '(none)'}`
  })
  const targets = await resolveMentions(note ?? '', { registry, origin })
  if (links) await links.syncMentions({ from: doc.iri, targets, actor })

  doc.userTags = tags
  doc.note = note
  doc.tags = [...new Set([...(doc.sourceTags ?? []), ...tags])]
  search.lexical.build(search.documents.values())
  return { tags, note, mentions: targets }
}
