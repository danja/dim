/**
 * #hashtags in Markdown.
 *
 *   #synth            a tag
 *   #music/synth      a tag under another (SKOS broader: music)
 *
 * A tag starts at a word boundary (start of text, after whitespace, or after
 * an opening bracket that is not a link target) with a letter, digit or _,
 * and has at least one letter: #123 is an issue number and /page#top an
 * anchor, neither a tag. Code is skipped. Tags are lower-case.
 */

export const MAX_TAG_LENGTH = 60
const SEGMENT = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_-]*'
export const HASHTAG_SOURCE = `(?<=^|\\s|(?<!\\])\\()#(${SEGMENT}(?:/${SEGMENT})*)`

/** The pattern, fresh each time (it is stateful with the g flag). */
export const hashtagPattern = () => new RegExp(HASHTAG_SOURCE, 'gmu')

/** → the tag in its normal form, or null when it isn't one. */
export function cleanTag (raw) {
  const tag = String(raw ?? '').normalize('NFC').toLowerCase().replace(/^#/, '').replace(/[-/]+$/, '')
  return tag && tag.length <= MAX_TAG_LENGTH && /\p{L}/u.test(tag) && !tag.includes('--') ? tag : null
}

function withoutCode (markdown) {
  return String(markdown ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

/** Markdown → the distinct tags in it, in order of appearance. */
export function parseHashtags (...markdown) {
  const out = new Set()
  for (const part of markdown) {
    for (const m of withoutCode(part).matchAll(hashtagPattern())) {
      const tag = cleanTag(m[1])
      if (tag) out.add(tag)
    }
  }
  return [...out]
}

/** 'music/synth' → ['music', 'music/synth'] */
export function withAncestors (tag) {
  const parts = tag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export default parseHashtags
