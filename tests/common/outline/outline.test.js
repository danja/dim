import { describe, it, expect } from 'vitest'
import { parseOutline, extractLinks, plainText, tidyText, walkOutline } from '../../../src/common/outline/OutlineParser.js'
import { parseWorkflowy } from '../../../src/gnamgnam/harvest/WorkflowyParser.js'

const SAMPLE = `Home

- Inbox
  - [
    Roland - P-6 | Creative Sampler
  ](https://www.roland.com/us/products/p-6/)
  - plain note
   - odd indent child
- 
-
#bass #tolo... | Instagram](https://www.instagram.com/p/X/)
  - [https://a.example/x](https://a.example/x)
- Projects
  - Seki
    - see https://seki.example/docs, and [spec](https://spec.example).
`

describe('OutlineParser', () => {
  const { title, items } = parseOutline(SAMPLE)

  it('reads the title and nests by indentation', () => {
    expect(title).toBe('Home')
    expect(items.map(i => i.text)).toEqual([
      'Inbox',
      '[#bass #tolo... | Instagram](https://www.instagram.com/p/X/)',
      'Projects'
    ])
    expect(items[0].children.map(i => i.text)).toEqual([
      '[Roland - P-6 | Creative Sampler](https://www.roland.com/us/products/p-6/)',
      'plain note'
    ])
    expect(items[0].children[1].children[0].text).toBe('odd indent child')
  })

  it('keeps source lines and drops empty bullets without children', () => {
    expect(items[0].children[0].line).toBe(4)
    expect(items).toHaveLength(3)
  })

  it('extracts markdown and bare links, and plain text', () => {
    expect(extractLinks('see https://seki.example/docs, and [spec](https://spec.example).')).toEqual([
      { text: 'spec', url: 'https://spec.example' },
      { text: '', url: 'https://seki.example/docs' }
    ])
    expect(extractLinks('[https://a.example/x](https://a.example/x)')).toEqual([{ text: '', url: 'https://a.example/x' }])
    expect(plainText('[Title](https://x.example) and [](https://y.example)')).toBe('Title and https://y.example')
    expect(tidyText('Title](https://z.example)')).toBe('[Title](https://z.example)')
  })

  it('walks depth first with ancestors', () => {
    const seen = []
    walkOutline(items, (item, ancestors) => seen.push(`${ancestors.length}:${plainText(item.text).slice(0, 8)}`))
    expect(seen).toEqual(['0:Inbox', '1:Roland -', '1:plain no', '2:odd inde', '0:#bass #t', '1:https://', '0:Projects', '1:Seki', '2:see http'])
  })

  it('treats a heading between bullets as a top-level item', () => {
    const { items: parsed } = parseOutline('- one\n  - child\n# **Section** two\n- three\n')
    expect(parsed.map(i => i.text)).toEqual(['one', '**Section** two', 'three'])
    expect(parsed[0].children.map(i => i.text)).toEqual(['child'])
  })
})

describe('parseWorkflowy on the outline parser', () => {
  it('gives each link its real ancestors as context', () => {
    const rows = parseWorkflowy(SAMPLE)
    const roland = rows.find(r => r.url.includes('roland'))
    expect(roland).toMatchObject({ linkText: 'Roland - P-6 | Creative Sampler', context: 'Inbox', sourceLine: 4 })
    const spec = rows.find(r => r.url === 'https://spec.example')
    expect(spec.context).toBe('Projects / Seki')
    const nested = rows.find(r => r.url === 'https://a.example/x')
    expect(nested.context).toBe('#bass #tolo... | Instagram')
  })
})
