import { describe, it, expect } from 'vitest'
import { renderPage, renderTabs } from '../../../src/common/ui/layout.js'
import { resolveInside } from '../../../src/common/http/staticFiles.js'

const TABS = [{ id: 'a', label: 'A & B', href: '/a/' }, { id: 'b', label: 'B', href: '/b/' }]

describe('layout', () => {
  it('marks only the active tab and escapes labels', () => {
    const html = renderTabs(TABS, 'b')
    expect(html).toMatch('<a href="/a/">A &amp; B</a>')
    expect(html).toMatch('<a href="/b/" aria-current="page">B</a>')
    expect(html).toMatch('aria-label="Facets"')
  })

  it('renders a mobile-ready page with an escaped title', () => {
    const html = renderPage({ title: '<x>', tabs: TABS, active: 'a', body: '<p>hi</p>' })
    expect(html).toMatch('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toMatch('<title>&lt;x&gt; · DIM</title>')
    expect(html).toMatch('/static/css/base.css')
    expect(html).toMatch('<main id="main">\n<p>hi</p>')
  })
})

describe('resolveInside', () => {
  it('keeps paths inside the root', () => {
    expect(resolveInside('/srv/public', 'css/base.css')).toBe('/srv/public/css/base.css')
    expect(resolveInside('/srv/public', '../secret')).toBe('/srv/public/secret')
    expect(resolveInside('/srv/public', '')).toBeNull()
  })
})
