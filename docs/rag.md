# Graph RAG

`GET /context.json?q=…`, the MCP tool `dim_context` and `bin/ask.js "…"` gather
what DIM holds on a question: hybrid search seeds, spread along links and
topics, ranked, with each item's text (`passage(iri)` facet hook) within a
character budget. DIM generates no answer; the caller cites the `href`s.

Defaults live in `RAG_CONFIG` (`config/preferences.js`). Every setting can be
tried per request, and the response echoes the `settings` used:

    node bin/ask.js --hops 1 --fanout 6 --similar --communities "modular synths"
    /context.json?q=modular+synths&hops=1&similar=1&communities=1
    dim_context { q, options: { hops: 1, similar: true } }

| Name | Setting | Default |
|---|---|---|
| `seeds` `hops` `hopDecay` `fanout` `limit` | search hits to start from; hops; score kept per extra hop; links followed per node; items returned | 8, 2, 0.5, 12, 15 |
| `charBudget` `passageChars` | total and per-item text | 12000, 1500 |
| `wPartOf` `wResource` `wRelated` `wMentions` | link kind weights | 0.9, 0.9, 0.8, 0.5 |
| `topicWeight` `topicMembers` | shared-topic expansion; topics bigger than this are skipped | 0.4, 30 |
| `similar` `similarK` `similarMin` `similarWeight` | **option**: also spread to each node's nearest embedding neighbours (computed per query; helps when links are sparse) | off, 4, 0.6, 0.7 |
| `communities` `communityK` `communityMin` `communityBoost` | **option**: add the clusters whose summaries match the question and boost their best-connected members | off, 2, 0.5, 0.5 |

## Communities

`node bin/communities.js` clusters the links graph (plus each small topic as a
hub) by label propagation with edges weighted by shared neighbours, asks a
local LLM (`OLLAMA_URL`, `RAG_CONFIG.communities.summaryModel`) for a summary
of each cluster, embeds it and writes `data/communities.json` (derived;
included in backups). A cluster with unchanged members keeps its summary, so
reruns only pay for what changed; with no LLM a list of titles stands in
(marked in `--list`). The server picks up a rebuild without a restart.

Clusters only reflect explicit links and topics, so they are as good as the
graph is dense; try `similar` and the link weights first.
