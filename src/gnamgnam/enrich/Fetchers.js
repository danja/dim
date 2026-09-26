/**
 * Pluggable fetchers for the second-pass enricher (docs/enricher.md).
 * One module per concern under ./fetch/; this file re-exports them so
 * callers import from one place.
 */
export { FetchError, REFUSALS, Fetcher, contentHash } from './fetch/Fetcher.js'
export { HttpFetcher } from './fetch/HttpFetcher.js'
export { GithubApiFetcher, ArxivFetcher, WikipediaFetcher } from './fetch/ApiFetchers.js'
export { Fetcher as default } from './fetch/Fetcher.js'
