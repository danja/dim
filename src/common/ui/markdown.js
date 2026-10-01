import { Marked } from 'marked'
import { esc } from '../http/respond.js'
import { hashtagPattern, cleanTag } from '../hashtags/parse.js'

/**
 * Markdown → safe HTML for notes and pages.
 *
 * Raw HTML in the source is shown as text, never rendered; link and image
 * targets must be http(s), mailto or a local path. [[type/slug]] becomes a
 * link to the resolver, [[Title]] a link to a search for it, #tag a link to
 * the tag's page.
 */

// Relative paths (./ ../) are safe too: the static blog export links posts that way.
const SAFE_HREF = /^(https?:|mailto:|\/(?!\/)|\.{1,2}\/|#)/i

function safeHref (href) {
  const h = String(href ?? '').trim()
  return SAFE_HREF.test(h) ? h : null
}

// Set for the duration of one (synchronous) parse: maps a local href
// ("/…") to another, or to null to render the link's text alone.
let localHref = null

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html ({ text }) {
      return esc(text)
    },
    link ({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      let target = safeHref(href)
      if (target && localHref && target.startsWith('/')) target = localHref(target)
      if (!target) return text
      return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`
    },
    image ({ href, text }) {
      const target = safeHref(href)
      return target ? `<a href="${esc(target)}">${esc(text || 'image')}</a>` : esc(text)
    }
  }
})

const findHref = title => `/find?q=${encodeURIComponent(title)}`

function linkWikiRefs (markdown, titleHref = findHref) {
  // Leave fenced and inline code alone; rewrite [[…]] and #tags everywhere else.
  return String(markdown ?? '').split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => i % 2
    ? part
    : part.replace(/\[\[([^\]\n]{1,200})\]\]/g, (_m, inner) => {
      const value = inner.trim()
      const ts = value.match(/^([a-z][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9-]*)$/)
      const href = ts ? `/r/${ts[1]}/${ts[2]}` : titleHref(value)
      const text = value.replace(/[[\]]/g, '')
      return href ? `[${text}](${href})` : text
    }).replace(hashtagPattern(), (m, raw) => {
      const tag = cleanTag(raw)
      return tag ? `[${m}](/tags/${encodeURIComponent(tag)})` : m
    })
  ).join('')
}

/**
 * titleHref: where [[Some title]] points (null: plain text). Default: a
 * search for it; the wiki points it at the page of that name (created on
 * follow). localHref: rewrites local links ("/…"), null to unlink them —
 * the static blog export uses it, since DIM's pages aren't published.
 */
export function renderMarkdown (markdown, { titleHref, localHref: mapLocal = null } = {}) {
  if (!markdown) return ''
  localHref = mapLocal
  try {
    return marked.parse(linkWikiRefs(markdown, titleHref))
  } finally {
    localHref = null
  }
}

/** One line of Markdown (a title) → safe inline HTML, no wrapping <p>. */
export function renderInline (markdown) {
  if (!markdown) return ''
  return marked.parseInline(linkWikiRefs(markdown))
}

export default renderMarkdown
