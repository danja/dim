import { describe, it, expect } from 'vitest'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import { pageTriples, revisionTriples, pageIri, revisionIri, slugForTitle } from '../../src/wiki/rdf.js'
import { WikiError } from '../../src/wiki/WikiStore.js'
import { memoryWiki } from './memoryWiki.js'
import { titleLinker, contentHtml, renderDiff } from '../../src/wiki/api/common.js'
import { rewritePageLinks, pageFromMarkdown, pagesFromMarkdownFiles, pagesFromDataset } from '../../src/wiki/importPages.js'
import { parseTurtle } from '../../src/common/rdf/TurtleReader.js'
import { diffLines, diffStats } from '../../src/common/text/diff.js'

describe('wiki RDF', () => {
  it('slugs titles and names revisions', () => {
    expect(slugForTitle('Getting Things Diced!')).toBe('getting-things-diced')
    expect(slugForTitle('???')).toBe('page')
    expect(revisionIri('a-b', 3)).toBe('http://purl.org/stuff/dim/page-revision/a-b--3')
  })

  it('writes pages and revisions that pass SHACL', async () => {
    const validator = await ShapeValidator.load()
    const page = { slug: 'x', iri: pageIri('x'), title: 'X "quoted"', content: 'Line\n[[Y]]', created: '2026-09-01T00:00:00Z', modified: '2026-09-02T00:00:00Z', revision: 2, tags: ['a', 'b'] }
    expect((await validator.validateTriples(pageTriples(page))).conforms).toBe(true)
    const rev = revisionTriples({ slug: 'x', page: page.iri, n: 2, title: page.title, content: page.content, at: page.modified, actor: 'owner' })
    expect(rev.some(t => t.includes('wasRevisionOf') && t.includes('x--1'))).toBe(true)
    expect((await validator.validateTriples(rev)).conforms).toBe(true)
    const untitled = pageTriples(page).filter(t => !t.includes('/title>'))
    expect((await validator.validateTriples(untitled)).conforms).toBe(false)
  })
})

describe('WikiStore', () => {
  it('numbers revisions and refuses a stale base', async () => {
    const { store, writes } = memoryWiki()
    const first = await store.save({ title: 'Home', content: 'one', tags: 'Start, start, home', actor: 'owner' })
    expect(first).toMatchObject({ slug: 'home', revision: 1, tags: ['start', 'home'], modified: null })
    const second = await store.save({ slug: 'home', title: 'Home', content: 'two\r\nlines', baseRevision: 1, actor: 'owner' })
    expect(second).toMatchObject({ revision: 2, content: 'two\nlines', tags: ['start', 'home'], created: first.created })
    expect(writes.map(w => w.op)).toEqual(['add', 'replace', 'add', 'replace'])

    const stale = await store.save({ slug: 'home', title: 'Home', content: 'mine', baseRevision: 1, actor: 'owner' }).catch(e => e)
    expect(stale).toBeInstanceOf(WikiError)
    expect(stale.status).toBe(409)
    expect(stale.current.revision).toBe(2)
    const clash = await store.save({ title: 'Home', content: 'again', actor: 'owner' }).catch(e => e)
    expect(clash.status).toBe(409)
    await expect(store.save({ title: '  ', content: 'x' })).rejects.toThrow('title')
    expect(await store.byTitle('HOME')).toBe(second)
  })
})

describe('wiki rendering', () => {
  const pages = [{ slug: 'home', title: 'Home' }]

  it('links [[Title]] to the page, or to a page to create', () => {
    const link = titleLinker(pages)
    expect(link('home')).toBe('/wiki/page/home')
    expect(link('New Idea')).toBe('/wiki/page/new-idea?title=New%20Idea')
    const html = contentHtml('See [[Home]], [[New Idea]] and [[bookmark/abc]]. <script>x</script>', pages)
    expect(html).toContain('href="/wiki/page/home"')
    expect(html).toContain('href="/wiki/page/new-idea?title=New%20Idea"')
    expect(html).toContain('href="/r/bookmark/abc"')
    expect(html).not.toContain('<script>')
    expect(contentHtml('Use `[[Home]]` to link', pages)).toContain('<code>[[Home]]</code>')
  })

  it('diffs lines and folds unchanged runs', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 10', 'line ten') + '\nextra'
    const diff = diffLines(before, after)
    expect(diffStats(diff)).toEqual({ added: 2, removed: 1 })
    const html = renderDiff(diff)
    expect(html).toContain('<li class="del"><span class="visually-hidden">removed: </span>line 10</li>')
    expect(html).toContain('class="fold">… 7 unchanged lines')
    expect(renderDiff(diffLines('same', 'same'))).toContain('No differences')
    expect(renderDiff(null)).toContain('Too large')
  })
})

describe('wiki import', () => {
  it('rewrites links between pages and leaves the rest', () => {
    const titles = new Map([['other page', 'Other Page']])
    const titleFor = t => titles.get(t.toLowerCase()) ?? null
    const out = rewritePageLinks('[Other Page](Other%20Page) [see](other page) [x](https://e.org) [y](Nowhere) ![i](Other Page) `[x](Other Page)`\n```\n[Other Page](Other Page)\n```', titleFor)
    expect(out).toBe('[[Other Page]] [see](/r/page/other-page) [x](https://e.org) [y](Nowhere) ![i](Other Page) `[x](Other Page)`\n```\n[Other Page](Other Page)\n```')
  })

  it('reads Markdown files: front matter, heading or file name', () => {
    expect(pageFromMarkdown('a.md', '---\ntitle: "Alpha"\ntags: [x, y]\n---\nBody')).toEqual({ title: 'Alpha', content: 'Body', tags: ['x', 'y'] })
    expect(pageFromMarkdown('b.md', '# Beta\n\nText')).toEqual({ title: 'Beta', content: 'Text', tags: [] })
    expect(pageFromMarkdown('gamma_ray-notes.md', 'Text').title).toBe('gamma ray notes')
    const pages = pagesFromMarkdownFiles([{ name: 'a.md', text: '# Alpha\nSee [Beta](b.md)' }, { name: 'b.md', text: '# Beta\nBack to [the start](./a.md)' }])
    expect(pages.map(p => p.content)).toEqual(['See [[Beta]]', 'Back to [the start](/r/page/alpha)'])
  })

  it('reads a foowiki dump', async () => {
    const dataset = await parseTurtle(`@prefix dc: <http://purl.org/dc/terms/> .
@prefix sioc: <http://rdfs.org/sioc/ns#> .
@prefix wiki: <http://hyperdata.it/wiki/> .
<http://hyperdata.it/wiki/Home> a wiki:Page ; dc:title "Home" ; dc:date "2014-03-01T10:00:00Z" ;
  sioc:content "Start at [Notes](Notes)." ; wiki:tag "meta" .
<http://hyperdata.it/wiki/Notes> a wiki:Page ; dc:title "Notes" ; sioc:content "Some notes." .
<http://hyperdata.it/wiki/x> dc:title "Not a page" .`)
    const pages = pagesFromDataset(dataset)
    expect(pages).toHaveLength(2)
    expect(pages.find(p => p.title === 'Home')).toEqual({ title: 'Home', content: 'Start at [[Notes]].', tags: ['meta'], created: '2014-03-01T10:00:00Z' })
  })
})
