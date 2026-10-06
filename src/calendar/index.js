import { registerRoutes } from './api/routes.js'

/**
 * Calendar — appointments to remember: what, which day, optionally when and
 * where. Private to the owner (it offers no public hooks: not find, tags,
 * related or the day view). graph:facet/calendar.
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
    }
  }
}

export default createCalendarFacet
