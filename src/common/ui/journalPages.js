import { esc } from '../http/respond.js'
import { renderPage } from './layout.js'
import { HIGHLIGHTS, isoDay } from '../journal/journal.js'

/** /day/<date> and /week/<date>: what you did, from the change log. */

const DAY = 86400000
const shift = (day, n) => isoDay(new Date(`${day}T00:00:00Z`).getTime() + n * DAY)
const nice = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const hm = iso => String(iso).slice(11, 16)

export function renderDay ({ day, entries, extra, today, tabs, session }) {
  const groups = new Map()
  for (const e of entries) {
    if (!groups.has(e.facetLabel)) groups.set(e.facetLabel, [])
    groups.get(e.facetLabel).push(e)
  }
  const sections = [...groups].map(([label, items]) => `<section><h2>${esc(label)} <small class="meta">${items.length}</small></h2>
<ul class="journal">${items.map(e => `<li><time datetime="${esc(e.last)}">${esc(hm(e.first))}${hm(e.first) !== hm(e.last) ? `–${esc(hm(e.last))}` : ''}</time> <a href="${esc(e.href)}">${esc(e.label)}</a>${e.summaries.length ? ` <small class="meta">${esc(e.summaries.slice(0, 3).join(' · '))}</small>` : ''}</li>`).join('')}</ul></section>`).join('\n')
  const arrived = extra.length ? `<section><h2>Arrived</h2><ul class="journal">${extra.map(x => `<li><a href="${esc(x.href)}">${esc(x.label)}</a> <small class="meta">${esc(x.facetLabel)}</small></li>`).join('')}</ul></section>` : ''
  const nav = `<nav class="day-nav" aria-label="Days"><a href="/day/${shift(day, -1)}">← ${esc(shift(day, -1))}</a> <a href="/week/${esc(day)}">the week</a>${day < today ? ` <a href="/day/${shift(day, 1)}">${esc(shift(day, 1))} →</a>` : ''}</nav>`
  const body = `<h1>${esc(nice(day))}</h1>
${nav}
${sections || '<p class="muted">Nothing recorded this day.</p>'}
${arrived}`
  return renderPage({ title: day, tabs, active: null, session, body })
}

export function renderWeek ({ start, days, today, tabs, session }) {
  const totals = Object.fromEntries(HIGHLIGHTS.map(([key]) => [key, days.flatMap(d => d.highlights[key])]))
  const lists = HIGHLIGHTS.filter(([key]) => totals[key].length).map(([key, label]) => `<section><h2>${esc(label)} <small class="meta">${totals[key].length}</small></h2><ul class="journal">${totals[key].map(e => `<li><a href="${esc(e.href)}">${esc(e.label)}</a></li>`).join('')}</ul></section>`).join('\n')
  const rows = days.map(d => `<tr><th scope="row"><a href="/day/${esc(d.day)}">${esc(new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }))}</a></th><td>${d.total}</td><td class="meta">${esc(Object.entries(d.byFacet).map(([f, n]) => `${f} ${n}`).join(' · '))}</td></tr>`).join('')
  const nav = `<nav class="day-nav" aria-label="Weeks"><a href="/week/${shift(start, -7)}">← previous week</a>${shift(start, 7) <= today ? ` <a href="/week/${shift(start, 7)}">next week →</a>` : ''}</nav>`
  const body = `<h1>Week of ${esc(nice(start))}</h1>
${nav}
<table class="week"><thead><tr><th scope="col">Day</th><th scope="col">Things</th><th scope="col">Where</th></tr></thead><tbody>${rows}</tbody></table>
${lists || '<p class="muted">No highlights this week.</p>'}`
  return renderPage({ title: `Week of ${start}`, tabs, active: null, session, body })
}
