import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createCalendarFacet } from '../../src/calendar/index.js'
import { memoryEvents } from './memoryEvents.js'

const TOKEN = 'test-token-0123456789abcdef'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }

let servers = []
async function listen () {
  const { store } = memoryEvents()
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createCalendarFacet({ store })]
  const server = createServer({ facets, defaultFacet: 'calendar', services: { auth: new Auth({ token: TOKEN }) } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, store }
}
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: AUTH, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() }))
const owner = { Authorization: `Bearer ${TOKEN}` }

describe('calendar routes', () => {
  it('is private: strangers are sent to log in, or told 401', async () => {
    const { base } = await listen()
    await post(base, '/calendar/events', { title: 'Therapy', date: '2026-10-08' })
    const page = await fetch(`${base}/calendar/`, { redirect: 'manual' })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/login?return=%2Fcalendar%2F')
    expect((await fetch(`${base}/calendar/`, { headers: { Accept: 'application/json' } })).status).toBe(401)
    const json = await fetch(`${base}/calendar/event/therapy.json`, { redirect: 'manual' })
    expect(json.status).toBe(401)
    expect(await json.text()).not.toContain('Therapy')
    expect((await fetch(`${base}/calendar/event/therapy/edit`, { redirect: 'manual' })).status).toBe(303)
    expect(JSON.stringify(await (await fetch(`${base}/find.json?q=therapy`)).json())).not.toContain('Therapy')
    expect(await (await fetch(`${base}/health`)).text()).not.toContain('Therapy')
    expect((await post(base, '/calendar/events', { title: 'x', date: '2026-10-08' })).status).toBe(200)
    const anon = await fetch(`${base}/calendar/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ title: 'x', date: '2026-10-08' }) })
    expect(anon.status).toBe(401)
  })

  it('adds, shows by day, edits and deletes appointments', async () => {
    const { base } = await listen()
    expect((await post(base, '/calendar/events', { title: 'Dentist', date: '2026-10-08', time: '14:30', location: 'High St <b>' })).json).toMatchObject({ ok: true, slug: 'dentist' })
    await post(base, '/calendar/events', { title: 'Birthday', date: '2026-10-07' })
    await post(base, '/calendar/events', { title: 'Old thing', date: '2026-10-01' })

    const html = await (await fetch(`${base}/calendar/`, { headers: owner })).text()
    expect(html.indexOf('Birthday')).toBeLessThan(html.indexOf('Dentist'))
    expect(html).toContain('Tomorrow, Wed 7 Oct 2026')
    expect(html).toContain('Thu 8 Oct 2026')
    expect(html).toContain('14:30')
    expect(html).toContain('High St &lt;b&gt;')
    expect(html).toContain('<input type="date" id="new-date" name="date" required value="2026-10-06">')
    expect(html).not.toContain('Old thing')
    expect(await (await fetch(`${base}/calendar/?view=past`, { headers: owner })).text()).toContain('Old thing')

    const json = await (await fetch(`${base}/calendar/`, { headers: AUTH })).json()
    expect(json.events.map(e => e.slug)).toEqual(['birthday', 'dentist'])

    expect((await post(base, '/calendar/event/dentist', { time: '15:00' })).json.ok).toBe(true)
    expect((await (await fetch(`${base}/calendar/event/dentist.json`, { headers: owner })).json()).time).toBe('15:00')
    expect(await (await fetch(`${base}/calendar/event/dentist/edit`, { headers: owner })).text()).toContain('value="15:00"')

    expect((await post(base, '/calendar/event/dentist/delete', {})).json.ok).toBe(true)
    expect((await fetch(`${base}/calendar/event/dentist.json`, { headers: owner })).status).toBe(404)
  })

  it('says why an appointment was not saved', async () => {
    const { base } = await listen()
    const bad = await post(base, '/calendar/events', { title: 'No day' })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toContain('needs a date')
    expect((await post(base, '/calendar/event/nothing', { title: 'x' })).status).toBe(404)
  })
})
