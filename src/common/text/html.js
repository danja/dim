/**
 * HTML → plain text, for feed summaries and the like. Regex-based and
 * dependency-free: the result is only ever shown escaped, so this is about
 * readability, not safety. Paragraph-ish breaks become blank lines.
 */

const NAMED = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  aacute: 'á',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  szlig: 'ß',
  ccedil: 'ç',
  deg: '°'
})

export function decodeEntities (text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    }
    return NAMED[code.toLowerCase()] ?? whole
  })
}

export function htmlToText (html, { max = Infinity } = {}) {
  const text = decodeEntities(String(html ?? '')
    .replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote|pre|tr|table|section|article|figure|header|footer)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.8 ? cut.slice(0, space) : cut}…`
}
