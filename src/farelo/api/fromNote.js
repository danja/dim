import { toIri } from '../../common/links/mentions.js'

/**
 * Move a note into Farelo as a task. `from`: a wiki page or outline item, as
 * an IRI, DIM URL or [[Title]]. The task takes the title, the text (an outline
 * item's note and its subtree as a Markdown list) and the page's tags; links
 * the note had are re-made on the task; then the note itself is deleted.
 * The task is made first, so a failure leaves the note where it was.
 */
export async function taskFromNote (from, { store, registry, services, origin, actor }) {
  const value = String(from ?? '').trim()
  if (!value) throw Object.assign(new Error('from: a wiki page or outline item'), { status: 400 })
  const iri = toIri(value, { registry, origin }) ?? await registry.resolveTitle(value.replace(/^\[\[|\]\]$/g, ''))
  const source = iri ? await registry.taskSource(iri) : null
  if (!source) throw Object.assign(new Error('A task can be made from a wiki page or an outline item; that is neither'), { status: 422 })

  const task = await store.create({ title: source.title, note: source.note, tags: source.tags }, actor)
  const links = (await services.links?.linksOf(iri).catch(() => [])) ?? []
  for (const l of links) {
    // Derived kinds (mentions, hashtags) are refused by add(): they come back from the texts.
    const [a, b] = l.direction === 'out' ? [task.iri, l.iri] : [l.iri, task.iri]
    await services.links.add({ from: a, kind: l.kind, to: b, actor }).catch(() => {})
  }
  await registry.discard(source.facet, { iri, actor })
  return task
}

export default taskFromNote
