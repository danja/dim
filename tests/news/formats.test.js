import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { parseFeed, FeedParseError, absoluteUrl } from '../../src/news/formats/feed.js'
import { discoverFeeds } from '../../src/news/formats/discover.js'
import { parseOpml, parseFeedList, parseSubscriptions, toOpml } from '../../src/news/formats/opml.js'
import { htmlToText, decodeEntities } from '../../src/common/text/html.js'

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('feed parsing', () => {
  it('reads RSS 2.0: CDATA, HTML titles, relative links, the fuller body', () => {
    const feed = parseFeed(fixture('rss2.xml'), { url: 'https://example.org/feed/' })
    expect(feed).toMatchObject({ format: 'rss', title: 'Synth & Wood', siteUrl: 'https://example.org/' })
    expect(feed.items[0]).toEqual({ guid: 'post-123', link: 'https://example.org/2026/09/vco', title: 'Building a VCO', published: '2026-09-22T10:00:00.000Z', author: 'Danny', summary: 'Long body\n\nSecond para…', categories: ['synth', 'diy'] })
    expect(feed.items[1]).toMatchObject({ guid: 'No guid, no link|', link: null, title: 'No guid, no link' })
    expect(feed.items[2].title).toBe('An item with no title but a description that is quite long indeed')
  })

  it('reads Atom, RSS 1.0 and JSON Feed', () => {
    const atom = parseFeed(fixture('atom.xml'))
    expect(atom).toMatchObject({ format: 'atom', title: 'Atom Example', siteUrl: 'https://atom.example/' })
    expect(atom.items[0]).toMatchObject({ guid: 'urn:uuid:1225c695', link: 'https://atom.example/posts/1', title: 'Atom entry', author: 'Ann', summary: 'Full content, longer than the summary', categories: ['rdf'] })
    const rdf = parseFeed(fixture('rss1.rdf'))
    expect(rdf.items[0]).toMatchObject({ guid: 'https://rdf.example/a', published: '2026-09-01T10:00:00.000Z', categories: ['linked data'] })
    const json = parseFeed(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'J', items: [{ id: 7, url: 'https://j.example/1', content_html: '<p>Hi</p>', authors: [{ name: 'Z' }] }] }))
    expect(json.items[0]).toMatchObject({ guid: '7', title: 'Hi', author: 'Z' })
  })

  it('says why a document is not a feed', () => {
    expect(() => parseFeed('<!doctype html><html><body>x</body></html>')).toThrow('An HTML page')
    expect(() => parseFeed('{"a":1}')).toThrow(FeedParseError)
    expect(() => parseFeed('')).toThrow('Empty')
    expect(parseFeed('<rss><channel><title>x</title><item><guid>1</guid></item>').items).toEqual([])
  })

  it('makes links safe IRIs', () => {
    expect(absoluteUrl('/a|b^c?x={y}', 'https://e.org/')).toBe('https://e.org/a%7Cb%5Ec?x=%7By%7D')
    expect(absoluteUrl('javascript:alert(1)', 'https://e.org/')).toBeNull()
  })
})

describe('HTML to text', () => {
  it('drops scripts and tags, keeps paragraphs, decodes entities, truncates at a word', () => {
    expect(htmlToText('<p>One&nbsp;&amp; <b>two</b></p><script>bad()</script><p>Three&#8230; &#x263A;</p>')).toBe('One & two\n\nThree… ☺')
    expect(htmlToText('alpha beta gamma delta', { max: 12 })).toBe('alpha beta…')
    expect(decodeEntities('&bogus; &lt;')).toBe('&bogus; <')
  })
})

describe('discovery and subscription lists', () => {
  it('finds feeds a page links to', () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">
<link rel="alternate" type="application/atom+xml" href="https://e.org/atom?a=1&amp;b=2"><link rel="stylesheet" href="/s.css"></head>`
    expect(discoverFeeds(html, 'https://e.org/blog/')).toEqual([
      { url: 'https://e.org/feed.xml', title: 'Posts', type: 'application/rss+xml' },
      { url: 'https://e.org/atom?a=1&b=2', title: null, type: 'application/atom+xml' }
    ])
    expect(discoverFeeds('<a href="/blog/feed/">RSS</a> <a href="/about">x</a>', 'https://e.org/').map(f => f.url)).toEqual(['https://e.org/blog/feed/'])
  })

  it('reads OPML (folders become tags) and URL lists, and writes OPML back', () => {
    const opml = `<?xml version="1.0"?><opml version="2.0"><body>
<outline text="Synths"><outline type="rss" text="Muff" xmlUrl="https://muff.example/rss"/></outline>
<outline type="rss" title="Loose" xmlUrl="https://loose.example/feed" category="rdf,web"/>
</body></opml>`
    const parsed = parseOpml(opml)
    expect(parsed).toEqual([{ url: 'https://muff.example/rss', title: 'Muff', tags: ['synths'] }, { url: 'https://loose.example/feed', title: 'Loose', tags: ['rdf', 'web'] }])
    expect(parseFeedList('# comment\nhttps://a.example/feed\n\nnot a url\nhttp://b.example/rss # trailing')).toEqual([{ url: 'https://a.example/feed', title: null, tags: [] }, { url: 'http://b.example/rss', title: null, tags: [] }])
    expect(parseSubscriptions(opml)).toHaveLength(2)
    const back = parseOpml(toOpml(parsed.map(p => ({ ...p, siteUrl: null }))))
    const byUrl = list => [...list].sort((a, b) => a.url.localeCompare(b.url))
    expect(byUrl(back)).toEqual(byUrl(parsed))
  })
})
