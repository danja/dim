/**
 * Feed dates → ISO (UTC), or null. Date.parse copes with RFC 822 and ISO
 * 8601 but not with most timezone abbreviations (BST, CET, CEST, AEST…),
 * which many feeds use; an item it can't date would fall back to the time
 * it was polled, and sort above everything else.
 */

// IST is read as Irish (+0100); India's is +0530. CST/EST/PST etc. Date.parse knows already.
const ZONES = Object.fromEntries(`
  BST +0100  IST +0100  WET +0000  WEST +0100  CET +0100  CEST +0200  MET +0100  MEST +0200
  EET +0200  EEST +0300  MSK +0300  SAST +0200  CAT +0200  EAT +0300  WAT +0100
  HKT +0800  SGT +0800  JST +0900  KST +0900  PHT +0800  WIB +0700
  AWST +0800  ACST +0930  ACDT +1030  AEST +1000  AEDT +1100  NZST +1200  NZDT +1300
  AKST -0900  AKDT -0800  HST -1000  NST -0330  NDT -0230  AST -0400  ADT -0300  BRT -0300  ART -0300
`.trim().split(/\s+/).reduce((pairs, word, i, all) => i % 2 ? pairs : [...pairs, [word, all[i + 1]]], []))

export function feedDate (value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  let t = Date.parse(s)
  if (Number.isNaN(t)) {
    const zone = s.match(/\s([A-Z]{2,5})$/)
    // A known abbreviation → its offset; an unknown one → read as UTC (hours out at worst, not undated).
    if (zone) t = Date.parse(`${s.slice(0, zone.index)} ${ZONES[zone[1]] ?? '+0000'}`)
  }
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

export default feedDate
