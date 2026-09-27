import { iri, typedLiteral } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import { CHANGES_GRAPH } from '../store/ChangeLog.js'

/**
 * What happened in a stretch of time, from the change log (every facet's
 * writes) plus what facets report through a day() hook (e.g. news that
 * arrived, which isn't a change of yours). Resources that no longer exist
 * are skipped; several changes to one thing collapse into one entry.
 */

const DAY = 86400000

/** "2026-09-27" → the day's start and end (UTC). null if not a date. */
export function dayRange (day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null
  const from = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(from.getTime())) return null
  return { from, to: new Date(from.getTime() + DAY) }
}

export const isoDay = date => new Date(date).toISOString().slice(0, 10)

/** The Monday on or before a day. */
export function weekStart (day) {
  const d = new Date(`${day}T00:00:00Z`)
  return isoDay(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)
}

/** Highlights worth counting in a review, recognised from change summaries. */
export const HIGHLIGHTS = Object.freeze([
  ['done', 'Tasks done', e => e.facet === 'farelo' && e.summaries.some(s => /→ done$/.test(s))],
  ['newTask', 'Tasks added', e => e.facet === 'farelo' && e.summaries.some(s => /^new task/.test(s))],
  ['bookmark', 'Bookmarks saved', e => e.facet === 'gnamgnam' && e.summaries.some(s => /^bookmark saved/.test(s))],
  ['page', 'Wiki pages started', e => e.facet === 'wiki' && e.summaries.some(s => s === 'new page')],
  ['published', 'Posts published', e => e.facet === 'blog' && e.summaries.some(s => s === 'published')]
])

/**
 * → { entries: [{ iri, label, href, facet, facetLabel, first, last, summaries }], extra: [{ facetLabel, label, href }] }
 */
export async function activity ({ client, queries, registry, from, to }) {
  const graph = GraphRegistry.graphIri(CHANGES_GRAPH.kind, CHANGES_GRAPH.id)
  let rows = []
  try {
    rows = await client.select(queries.get('changes/between', { graph: iri(graph), from: typedLiteral(from), to: typedLiteral(to) }))
  } catch {
    rows = []
  }
  const byResource = new Map()
  for (const r of rows) {
    const e = byResource.get(r.resource) ?? { iri: r.resource, first: r.at, last: r.at, summaries: [] }
    e.last = r.at
    if (r.summary && !e.summaries.includes(r.summary)) e.summaries.push(r.summary)
    byResource.set(r.resource, e)
  }
  const entries = []
  for (const e of byResource.values()) {
    const found = await registry.lookup(e.iri)
    if (found?.href && found.facet) entries.push({ ...e, label: found.label, href: found.href, facet: found.facet, facetLabel: found.facetLabel })
  }
  const extra = []
  for (const facet of registry.facets) {
    try {
      for (const item of (await facet.day?.({ from, to })) ?? []) extra.push({ facet: facet.id, facetLabel: facet.label, ...item })
    } catch { /* one facet failing must not hide the rest */ }
  }
  return { entries, extra }
}

/** Seven days of activity, counted by facet and highlight. */
export async function week ({ start, ...deps }) {
  const days = []
  for (let i = 0; i < 7; i++) {
    const day = isoDay(new Date(`${start}T00:00:00Z`).getTime() + i * DAY)
    const { from, to } = dayRange(day)
    const { entries, extra } = await activity({ ...deps, from, to })
    const byFacet = {}
    for (const e of entries) byFacet[e.facetLabel] = (byFacet[e.facetLabel] ?? 0) + 1
    const highlights = Object.fromEntries(HIGHLIGHTS.map(([key, , test]) => [key, entries.filter(test)]))
    days.push({ day, byFacet, highlights, extra, total: entries.length })
  }
  return days
}
