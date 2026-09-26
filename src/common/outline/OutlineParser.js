/**
 * Parse a Markdown bullet outline (Workflowy's export: "- " items, two
 * spaces per level) into a tree.
 *
 * Workflowy wraps long link titles across lines —
 *
 *   - [
 *     Roland - P-6 | Creative Sampler
 *   ](https://www.roland.com/…)
 *
 * — so any non-bullet line continues the item above it, and the pieces are
 * joined before links are read. Nesting follows indentation by comparison
 * (not by dividing by two), so an odd indent still lands under the nearest
 * shallower item.
 */

const BULLET = /^([ \t]*)-(?:[ \t]+(.*))?$/
const MD_LINK = /\[([^\]]*)\]\((https?:[^)\s]+)\)/g
const BARE_URL = /(https?:\/\/[^\s)>\]]+)/g

function indentOf (whitespace) {
  return whitespace.replace(/\t/g, '  ').length
}

/**
 * Joined continuation text → one line, with "[ Title ](url)" tidied to
 * "[Title](url)". A title whose opening "[" the export dropped
 * ("Title](url)") gets it back.
 */
export function tidyText (raw) {
  const text = raw
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]\(/g, '](')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return /^[^[]*\]\(https?:/.test(text) ? `[${text}` : text
}

function trimUrl (url) {
  return url.replace(/[),.]+$/, '')
}

/** Links in an item: markdown links first, then bare URLs outside them. → [{ text, url }] */
export function extractLinks (text) {
  const links = []
  for (const m of text.matchAll(MD_LINK)) {
    const url = trimUrl(m[2].trim())
    const label = (m[1] || '').trim()
    links.push({ text: label === url ? '' : label, url })
  }
  const rest = text.replace(MD_LINK, ' ')
  for (const m of rest.matchAll(BARE_URL)) links.push({ text: '', url: trimUrl(m[1]) })
  return links
}

/** Item text with markdown links reduced to their text (or URL). */
export function plainText (text) {
  return text.replace(MD_LINK, (_m, label, url) => (label && label.trim()) || url).replace(/\s{2,}/g, ' ').trim()
}

/**
 * → { title, items }. Each item: { text, line, children }, where text is the
 * tidied Markdown of the item and line its first line (1-based).
 * Empty bullets are dropped unless they have children.
 */
export function parseOutline (source) {
  const lines = String(source ?? '').split('\n')
  const root = { text: null, line: 0, children: [], indent: -1 }
  const stack = [root]
  let title = null
  let last = null

  lines.forEach((line, i) => {
    const bullet = line.match(BULLET)
    if (bullet) {
      const indent = indentOf(bullet[1])
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
      const item = { text: bullet[2] ?? '', line: i + 1, children: [], indent }
      stack[stack.length - 1].children.push(item)
      stack.push(item)
      last = item
      return
    }
    if (!line.trim()) return
    if (!last) {
      title = title ?? line.trim()
      return
    }
    last.text += `\n${line}`
  })

  const finish = items => items
    .map(item => ({ text: tidyText(item.text), line: item.line, children: finish(item.children) }))
    .filter(item => item.text || item.children.length)
  return { title, items: finish(root.children) }
}

/** Depth-first walk: visit(item, ancestors). */
export function walkOutline (items, visit, ancestors = []) {
  for (const item of items) {
    visit(item, ancestors)
    walkOutline(item.children, visit, [...ancestors, item])
  }
}
