const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * A DIM page as text for an agent: the main content, links as `text (href)`.
 * Pages that offer .json or .md are better read that way; this is for the rest.
 */
export function htmlText (html) {
  let s = String(html)
  const main = s.match(/<main[\s>][\s\S]*<\/main>/i)
  if (main) s = main[0]
  return s
    .replace(/<(script|style|nav|header|footer|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `${text.replace(/<[^>]+>/g, '')} (${href})`)
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table|form)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<textarea[^>]*>([\s\S]*?)<\/textarea>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default htmlText
