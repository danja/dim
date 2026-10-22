import { RAG_CONFIG } from '../../../config/preferences.js'

/**
 * Per-request tuning of RAG_CONFIG, so a setup can be found by trying: the
 * query string of /context.json and the flags of bin/ask.js use these names.
 * Unknown names are ignored; values are clamped. → a full config.
 */

const num = (min, max) => ({ min, max })
const bool = { bool: true }

const SPEC = {
  seeds: ['seeds', num(1, 30)],
  hops: ['hops', num(0, 3)],
  hopDecay: ['hopDecay', num(0, 1)],
  fanout: ['fanout', num(1, 50)],
  limit: ['limit', num(1, 50)],
  charBudget: ['charBudget', num(500, 60000)],
  passageChars: ['passageChars', num(100, 6000)],
  topicWeight: ['topicWeight', num(0, 2)],
  topicMembers: ['topicMembers', num(1, 200)],
  wPartOf: ['kindWeights.partOf', num(0, 2)],
  wResource: ['kindWeights.resource', num(0, 2)],
  wRelated: ['kindWeights.related', num(0, 2)],
  wMentions: ['kindWeights.mentions', num(0, 2)],
  similar: ['similarity.enabled', bool],
  similarK: ['similarity.k', num(1, 20)],
  similarMin: ['similarity.minScore', num(0, 1)],
  similarWeight: ['similarity.weight', num(0, 2)],
  communities: ['communities.enabled', bool],
  communityK: ['communities.k', num(1, 10)],
  communityMin: ['communities.minScore', num(0, 1)],
  communityBoost: ['communities.memberBoost', num(0, 2)]
}

export const OPTION_NAMES = Object.freeze(Object.keys(SPEC))

const parse = (raw, rule) => {
  if (rule.bool) return /^(1|true|yes|on|)$/i.test(String(raw))
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(rule.max, Math.max(rule.min, n)) : undefined
}

/** @param {Iterable<[string, string]>} pairs e.g. url.searchParams */
export function tune (pairs, base = RAG_CONFIG) {
  const config = structuredClone(base)
  for (const [name, raw] of pairs) {
    const entry = SPEC[name]
    if (!entry) continue
    const value = parse(raw, entry[1])
    if (value === undefined) continue
    const path = entry[0].split('.')
    const key = path.pop()
    const holder = path.reduce((o, k) => o[k], config)
    holder[key] = value
  }
  return config
}

export default tune
