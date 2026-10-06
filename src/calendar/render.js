import { esc } from '../common/http/respond.js'

/** Appointment dates for display. Dates are plain days, so no timezone maths. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const eventPath = event => `/calendar/event/${event.slug}`

/** "2026-10-06" → "Tue 6 Oct 2026" */
export function dayLabel (date) {
  const [y, m, d] = date.split('-').map(Number)
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`
}

/** The day after a "YYYY-MM-DD". */
export function nextDay (date) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** [{ date, events }] in the order given. */
export function groupByDay (events) {
  const groups = []
  for (const event of events) {
    const last = groups[groups.length - 1]
    if (last?.date === event.date) last.events.push(event)
    else groups.push({ date: event.date, events: [event] })
  }
  return groups
}

export function eventList (events, { today }) {
  if (!events.length) return '<p class="muted">Nothing here.</p>'
  const tomorrow = nextDay(today)
  return groupByDay(events).map(({ date, events: day }) => {
    const label = date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : null
    const heading = `<h2><time datetime="${esc(date)}">${label ? `${label}, ` : ''}${esc(dayLabel(date))}</time></h2>`
    const items = day.map(e => `<li><a class="when" href="${esc(eventPath(e))}/edit">${e.time ? esc(e.time) : 'All day'}</a>
<div><a href="${esc(eventPath(e))}/edit">${esc(e.title)}</a>${e.location ? `<p class="meta">${esc(e.location)}</p>` : ''}${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}</div></li>`).join('\n')
    return `<section class="day">${heading}<ul class="events">${items}</ul></section>`
  }).join('\n')
}
