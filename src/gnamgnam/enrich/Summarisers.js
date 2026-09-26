/**
 * Pluggable summarisers for the second-pass enricher (docs/enricher.md).
 * One module per concern under ./summarise/; this file re-exports them so
 * callers import from one place.
 */
export { SummariseError, Summariser } from './summarise/Summariser.js'
export { splitSentences, extractKeywords, normaliseKeywords, buildMarkdown } from './summarise/text.js'
export { ExtractiveSummariser, MechanicalSummariser } from './summarise/ExtractiveSummarisers.js'
export { OllamaSummariser, parseStructuredReply } from './summarise/OllamaSummariser.js'
export { RemoteSummariser } from './summarise/RemoteSummariser.js'
export { Summariser as default } from './summarise/Summariser.js'
