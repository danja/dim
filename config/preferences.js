/**
 * Tunable constants for DIM. Copied from plugin-universe config/preferences.js,
 * trimmed to what bookmarks need.
 */
export const RETRIEVAL_CONFIG = {
  lexicalWeight: 1.0,
  vectorWeight: 0.7,
  minSimilarity: 0.58,
  candidateLimit: 200,
  defaultPageSize: 20,
  maxPageSize: 100
}

export const SOURCE_PRECEDENCE = {
  measurement: 60,
  discovery: 50,
  vendor: 40,
  registry: 30,
  curated: 20,
  user: 10
}

export const HARVEST_CONFIG = {
  requestIntervalMs: 1000,
  hostConcurrency: 1,
  userAgent: 'dim-harvester/0.1 (+http://localhost:4110/about/crawler)',
  requestTimeoutMs: 30000,
  maxRetries: 3
}

export const EMBEDDING_CONFIG = {
  requestTimeoutMs: 60000,
  maxRetries: 3,
  retryBackoffMs: 500,
  batchSize: 32
}

export const ENRICH_CONFIG = {
  summaryMaxChars: 1000,
  markdownMaxChars: 4000,
  keywordMax: 12,
  extractMaxChars: 20000,
  fetchMaxBytes: 2 * 1024 * 1024,
  cacheTtlMs: 30 * 24 * 3600 * 1000,
  summariser: 'ollama',
  model: 'qwen2.5:3b',
  promptVersion: 'summary-v1',
  checkpointEvery: 100
}
