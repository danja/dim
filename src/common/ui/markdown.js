import { Marked } from 'marked'
import { esc } from '../http/respond.js'

/**
 * Markdown → safe HTML for notes and pages.
 *
 * Raw HTML in the source is shown as text, never rendered; link and image
 * targets must be http(s), mailto or a local path. [[type/slug]] becomes a
 * link to the resolver, [[Title]] a link to a search for it.
 */

const SAFE_HREF = /^(https?:|mailto:|\/(?!\/)|#)/i

function safeHref (href) {
  const h = String(href ?? '').trim()
  return SAFE_HREF.test(h) ? h : null
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html ({ text }) {
      return esc(text)
    },
    link ({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const target = safeHref(href)
      if (!target) return text
      return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`
    },
    image ({ href, text }) {
      const target = safeHref(href)
      return target ? `<a href="${esc(target)}">${esc(text || 'image')}</a>` : esc(text)
    }
  }
})

function linkWikiRefs (markdown) {
  // Leave fenced code alone; rewrite [[…]] everywhere else.
  return String(markdown ?? '').split(/(```[\s\S]*?```)/g).map((part, i) => i % 2
    ? part
    : part.replace(/\[\[([^\]\n]{1,200})\]\]/g, (_m, inner) => {
      const value = inner.trim()
      const ts = value.match(/^([a-z][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9-]*)$/)
      const href = ts ? `/r/${ts[1]}/${ts[2]}` : `/find?q=${encodeURIComponent(value)}`
      return `[${value.replace(/[[\]]/g, '')}](${href})`
    })
  ).join('')
}

export function renderMarkdown (markdown) {
  if (!markdown) return ''
  return marked.parse(linkWikiRefs(markdown))
}

/** One line of Markdown (a title) → safe inline HTML, no wrapping <p>. */
export function renderInline (markdown) {
  if (!markdown) return ''
  return marked.parseInline(linkWikiRefs(markdown))
}

export default renderMarkdown
