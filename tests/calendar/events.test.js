import { describe, it, expect } from 'vitest'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import { eventTriples, eventIri } from '../../src/calendar/rdf.js'
import { validDate, localDay, EventError } from '../../src/calendar/EventStore.js'
import { dayLabel, nextDay } from '../../src/calendar/render.js'
import { memoryEvents } from './memoryEvents.js'

describe('dates', () => {
  it('accepts only real days', () => {
    expect(validDate('2026-10-06')).toBe(true)
    expect(validDate('2028-02-29')).toBe(true)
    expect(validDate('2026-02-29')).toBe(false)
    expect(validDate('2026-13-01')).toBe(false)
    expect(validDate('6/10/2026')).toBe(false)
    expect(validDate('')).toBe(false)
  })

  it('names the local day, and labels days without a timezone shift', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dayLabel('2026-10-06')).toBe('Tue 6 Oct 2026')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})

describe('EventStore', () => {
  it('creates an appointment, tidied, with a slug from the title', async () => {
    const { store, writes } = memoryEvents()
    const event = await store.create({ title: '  Dentist ', date: '2026-10-08', time: '14:30', location: 'High St', notes: 'Bring the form' }, 'owner')
    expect(event).toMatchObject({ slug: 'dentist', iri: eventIri('dentist'), title: 'Dentist', date: '2026-10-08', time: '14:30', location: 'High St', notes: 'Bring the form', modified: null })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ graph: 'graph:facet/calendar', subject: eventIri('dentist'), actor: 'owner', summary: 'new appointment' })
    expect((await store.create({ title: 'Dentist', date: '2026-11-08' }, 'owner')).slug).toBe('dentist-2')
  })

  it('refuses what is not an appointment', async () => {
    const { store, writes } = memoryEvents()
    await expect(store.create({ date: '2026-10-08' }, 'o')).rejects.toThrow('needs a title')
    await expect(store.create({ title: 'x' }, 'o')).rejects.toThrow('needs a date')
    await expect(store.create({ title: 'x', date: '2026-02-30' }, 'o')).rejects.toThrow('needs a date')
    await expect(store.create({ title: 'x', date: '2026-10-08', time: '25:00' }, 'o')).rejects.toThrow('HH:MM')
    await expect(store.create({ title: 'x'.repeat(201), date: '2026-10-08' }, 'o')).rejects.toBeInstanceOf(EventError)
    expect(writes).toEqual([])
  })

  it('lists upcoming soonest first (all-day before timed) and past latest first', async () => {
    const { store } = memoryEvents()
    for (const [title, date, time] of [['Later', '2026-10-09', null], ['Lunch', '2026-10-06', '12:30'], ['Today all day', '2026-10-06', null], ['Last week', '2026-09-30', '09:00'], ['Yesterday', '2026-10-05', null]]) {
      await store.create({ title, date, time }, 'o')
    }
    expect((await store.list()).map(e => e.title)).toEqual(['Today all day', 'Lunch', 'Later'])
    expect((await store.list({ view: 'past' })).map(e => e.title)).toEqual(['Yesterday', 'Last week'])
  })

  it('edits (an empty time makes it all-day) and deletes', async () => {
    const { store, writes } = memoryEvents()
    const event = await store.create({ title: 'Call Ann', date: '2026-10-07', time: '10:00' }, 'o')
    const edited = await store.update(event, { time: '', location: 'Phone' }, 'o')
    expect(edited).toMatchObject({ title: 'Call Ann', time: null, location: 'Phone' })
    expect(edited.modified).toBe(new Date(2026, 9, 6, 12).toISOString())
    await expect(store.update(edited, { title: ' ' }, 'o')).rejects.toThrow('needs a title')
    await store.delete(edited, 'o')
    expect(await store.get('call-ann')).toBeNull()
    expect(writes.at(-1)).toMatchObject({ op: 'delete', subjects: [eventIri('call-ann')] })
  })
})

describe('event triples', () => {
  it('pass SHACL, and bad ones do not', async () => {
    const validator = await ShapeValidator.load()
    const event = { slug: 'dentist', iri: eventIri('dentist'), title: 'Dentist', date: '2026-10-08', time: '14:30', location: 'High St', notes: 'n', created: '2026-10-06T10:00:00.000Z', modified: '2026-10-06T11:00:00.000Z' }
    expect((await validator.validateTriples(eventTriples(event))).conforms).toBe(true)
    expect((await validator.validateTriples(eventTriples({ ...event, time: null, location: null, notes: null, modified: null }))).conforms).toBe(true)
    expect((await validator.validateTriples(eventTriples({ ...event, time: '24:99' }))).conforms).toBe(false)
    expect((await validator.validateTriples(eventTriples({ ...event, date: 'next week' }))).conforms).toBe(false)
    expect((await validator.validateTriples(eventTriples({ ...event, title: '' }))).conforms).toBe(false)
  })
})
