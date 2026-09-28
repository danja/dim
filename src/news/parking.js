import { NEWS_CONFIG } from '../../config/preferences.js'

/**
 * Failing feeds are parked: listed apart on the admin page and not polled
 * (by the server, `poll`, or `poll --all`) until tried again or returned.
 * A refused or gone feed is parked at once; one that errors, after
 * `parkAfterFailures` failures in a row. A successful poll unparks.
 */
export function shouldPark ({ status, failures = 0 }, after = NEWS_CONFIG.parkAfterFailures) {
  return status === 'refused' || status === 'gone' || failures >= after
}

export default shouldPark
