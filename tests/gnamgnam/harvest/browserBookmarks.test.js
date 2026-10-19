import { describe, it, expect } from 'vitest'
import { parseBrowserBookmarks } from '../../../src/gnamgnam/harvest/BrowserBookmarks.js'

const EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://example.com/a" ADD_DATE="1">Alpha &amp; Omega</A>
    <DT><H3>Music</H3>
    <DL><p>
      <DT><A HREF="https://example.com/b">Beta</A>
      <DT><A HREF="https://example.com/a">Alpha again</A>
    </DL><p>
    <DT><A HREF="javascript:void(0)">Bookmarklet</A>
  </DL><p>
  <DT><A HREF="https://example.com/c"></A>
</DL>`

describe('parseBrowserBookmarks', () => {
  const marks = parseBrowserBookmarks(EXPORT)
  it('reads titles, decoding entities', () => {
    expect(marks.find(m => m.url === 'https://example.com/a').title).toBe('Alpha & Omega')
  })
  it('turns folders into tags but not the bookmarks bar', () => {
    expect(marks.find(m => m.url === 'https://example.com/a').tags).toEqual([])
    expect(marks.find(m => m.url === 'https://example.com/b').tags).toEqual(['music'])
  })
  it('drops non-http links and duplicates', () => {
    expect(marks.map(m => m.url)).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
  })
  it('leaves a missing title null', () => {
    expect(marks[2].title).toBeNull()
  })
})
