import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { formFields } from '../../common/http/write.js'
import { eventList, eventPath } from '../render.js'

/** Calendar pages: upcoming and past appointments, and the editor. */

export function calendarPage ({ title, body, tabs, session }) {
  return renderPage({ title, tabs, active: 'calendar', session, body, head: '<link rel="stylesheet" href="/static/css/calendar.css">' })
}

/** The fields of an appointment, as a form body. values: what to show in them. */
function fields (values, id) {
  return `<label for="${id}-title">What</label>
<input type="text" id="${id}-title" name="title" required maxlength="200" value="${esc(values.title ?? '')}">
<div class="when-fields">
<div><label for="${id}-date">Date</label>
<input type="date" id="${id}-date" name="date" required value="${esc(values.date ?? '')}"></div>
<div><label for="${id}-time">Time (optional)</label>
<input type="time" id="${id}-time" name="time" value="${esc(values.time ?? '')}"></div>
</div>
<label for="${id}-location">Where (optional)</label>
<input type="text" id="${id}-location" name="location" maxlength="200" value="${esc(values.location ?? '')}">
<label for="${id}-notes">Notes (optional)</label>
<textarea id="${id}-notes" name="notes" rows="3" maxlength="5000">${esc(values.notes ?? '')}</textarea>`
}

export function renderIndex ({ events, view, today, tabs, session }) {
  const past = view === 'past'
  const add = past
    ? ''
    : `<form class="edit add-event" method="post" action="/calendar/events">${formFields(session, '')}
${fields({ date: today }, 'new')}
<button>Add appointment</button>
</form>`
  const switcher = past
    ? '<p class="cal-nav"><a href="/calendar/">← Upcoming</a></p>'
    : '<p class="meta cal-nav"><a href="/calendar/?view=past">Past appointments</a></p>'
  const body = `<h1>${past ? 'Past appointments' : 'Calendar'}</h1>
${add}
${eventList(events, { today })}
${switcher}`
  return calendarPage({ title: past ? 'Past appointments' : 'Calendar', body, tabs, session })
}

export function renderEdit ({ event, tabs, session }) {
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/calendar/">Calendar</a></nav>
<h1>${esc(event.title)}</h1>
<form class="edit" method="post" action="${esc(eventPath(event))}">${formFields(session, '')}
${fields(event, 'edit')}
<div class="event-actions">
<button>Save</button>
<a href="/calendar/">Cancel</a>
</div>
</form>
<form method="post" action="${esc(eventPath(event))}/delete" data-confirm="Delete this appointment?">${formFields(session, '/calendar/')}<button class="secondary danger">Delete</button></form>`
  return calendarPage({ title: `Edit: ${event.title}`, body, tabs, session })
}
