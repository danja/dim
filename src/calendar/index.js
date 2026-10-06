import { registerRoutes } from './api/routes.js'
import { addDays } from './EventStore.js'
import { eventPath, relativeLabel } from './render.js'

/**
 * Calendar — appointments to remember: what, which day, optionally when and
 * where. Private to the owner (it offers no public hooks: not find, tags,
 * related or the day view). It does offer `upcoming`, which only ever reaches
 * pages shown to the owner (Squirt's "Coming up"). graph:facet/calendar.
 */

export function createCalendarFacet ({ store }) {
  if (!store) throw new Error('The calendar needs an EventStore')
  return {
    id: 'calendar',
    label: 'Calendar',
    description: 'Calendar: appointments to remember, by day.',
    types: { event: '/calendar/event/' },

    routes (router, ctx) {
      registerRoutes(router, { store, ...ctx })
    },

    async health () {
      return { status: 'ok', upcoming: (await store.list()).length }
    },

    /**
     * Today and the next `days` days, ready to show: callers must only show
     * this to the owner. past: today's timed appointment already begun.
     */
    async upcoming ({ days = 2 } = {}) {
      const today = store.today()
      const now = store.clockTime()
      return (await store.between(today, addDays(today, days))).map(e => ({
        date: e.date,
        dayLabel: relativeLabel(e.date, today),
        time: e.time,
        title: e.title,
        location: e.location,
        href: `${eventPath(e)}/edit`,
        past: e.date === today && Boolean(e.time) && e.time < now
      }))
    }
  }
}

export default createCalendarFacet
