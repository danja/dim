/**
 * Link status of a bookmark, derived from the last HTTP status seen: the
 * enrichment fetch (dim:fetchStatus) when there is one, else the first-pass
 * probe (dim:httpStatus). Not stored — recomputed whenever documents load.
 *
 *   ok        — 1xx–3xx
 *   dead      — 404 Not Found, 410 Gone
 *   blocked   — 401, 403, 429, 451: the site refused us, the page may be fine
 *   error     — any other 4xx/5xx
 *   unchecked — never fetched
 */

export const LINK_STATUSES = Object.freeze(['ok', 'dead', 'blocked', 'error', 'unchecked'])

export const DEAD_CODES = new Set([404, 410])
export const BLOCKED_CODES = new Set([401, 403, 429, 451])

function code (value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null
}

export function linkStatus ({ httpStatus = null, fetchStatus = null } = {}) {
  const status = code(fetchStatus) ?? code(httpStatus)
  if (status === null) return 'unchecked'
  if (DEAD_CODES.has(status)) return 'dead'
  if (BLOCKED_CODES.has(status)) return 'blocked'
  if (status >= 400) return 'error'
  return 'ok'
}

export default linkStatus
