import { iri } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import { slugify } from '../common/rdf/URIMinter.js'
import { EVENT_PREDICATES, eventTriples, eventIri } from './rdf.js'

/**
 * Appointments in graph:facet/calendar, in memory (loaded once) and written
 * through. The date is "YYYY-MM-DD" and the time an optional "HH:MM", both as
 * written: no timezone, so an appointment never moves when you travel.
 */

export class EventError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'EventError'
    this.status = status
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function validDate (value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** The local calendar day of a Date, as "YYYY-MM-DD". */
export function localDay (date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const text = (value, max, what) => {
  const clean = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (clean.length > max) throw new EventError(`${what} is longer than ${max} characters`)
  return clean || null
}

/** Check and tidy the fields of an appointment; only those present are returned. */
function cleanFields (fields) {
  const out = {}
  if ('title' in fields) {
    out.title = text(fields.title, 200, 'The title')
    if (!out.title) throw new EventError('An appointment needs a title')
  }
  if ('date' in fields) {
    out.date = String(fields.date ?? '').trim()
    if (!validDate(out.date)) throw new EventError('An appointment needs a date, as YYYY-MM-DD')
  }
  if ('time' in fields) {
    out.time = String(fields.time ?? '').trim() || null
    if (out.time && !TIME.test(out.time)) throw new EventError('The time is HH:MM, 24 hours')
  }
  if ('location' in fields) out.location = text(fields.location, 200, 'The location')
  if ('notes' in fields) out.notes = text(fields.notes, 5000, 'The notes')
  return out
}

/** Soonest first; an all-day appointment comes before timed ones that day. */
const sooner = (a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`) || a.title.localeCompare(b.title)

export class EventStore {
  constructor ({ client, repository, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('EventStore needs a client and a Repository')
    Object.assign(this, { client, repository, queries, now })
    this.events = null
  }

  async graph () {
    return this.repository.facetGraph('calendar', { comment: 'Appointments' })
  }

  async all () {
    if (this.events) return this.events
    const rows = await this.client.select(this.queries.get('calendar/events', { graph: iri(await this.graph()) }))
    this.events = new Map(rows.map(r => [r.slug, {
      slug: r.slug,
      iri: r.event,
      title: r.title,
      date: String(r.date).slice(0, 10),
      time: r.time ?? null,
      location: r.location ?? null,
      notes: r.notes ?? null,
      created: r.created,
      modified: r.modified ?? null
    }]))
    return this.events
  }

  reset () {
    this.events = null
  }

  today () {
    return localDay(this.now())
  }

  /** upcoming (today on, soonest first) or past (before today, latest first). */
  async list ({ view = 'upcoming' } = {}) {
    const today = this.today()
    const all = [...(await this.all()).values()]
    return view === 'past'
      ? all.filter(e => e.date < today).sort((a, b) => sooner(b, a))
      : all.filter(e => e.date >= today).sort(sooner)
  }

  async get (slug) {
    return (await this.all()).get(slug) ?? null
  }

  /** A slug from the title, unique among appointments. */
  async freeSlug (title) {
    let base
    try { base = slugify(String(title)) } catch { base = 'appointment' }
    const events = await this.all()
    let slug = base
    for (let n = 2; events.has(slug); n++) slug = `${base}-${n}`
    return slug
  }

  async create (fields, actor) {
    const clean = cleanFields({ title: '', date: '', time: null, location: null, notes: null, ...fields })
    const slug = await this.freeSlug(clean.title)
    const event = { slug, iri: eventIri(slug), ...clean, created: this.now().toISOString(), modified: null }
    return this.#write(event, actor, 'new appointment')
  }

  async update (event, fields, actor) {
    const next = { ...event, ...cleanFields(fields), modified: this.now().toISOString() }
    return this.#write(next, actor, `edit ${Object.keys(fields).join(', ')}`)
  }

  async delete (event, actor) {
    await this.repository.deleteResources({ graph: await this.graph(), subjects: [event.iri], actor, summary: `deleted appointment ${event.title}` })
    ;(await this.all()).delete(event.slug)
  }

  async #write (event, actor, summary) {
    await this.repository.replace({ graph: await this.graph(), subject: event.iri, predicates: EVENT_PREDICATES, triples: eventTriples(event), actor, summary })
    ;(await this.all()).set(event.slug, event)
    return event
  }
}

export default EventStore
