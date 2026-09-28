# GnamGnam — Commands

The command-line tools for the bookmark facet, in the order a full run uses
them. Everything runs from the repository root. Settings come from `.env`
(copy `.env.example`); **a variable already exported in your shell wins over
`.env`**, so use a fresh terminal after experimenting with `export`.

Background: `docs/tools.md` (all tools and the HTTP API), `docs/enricher.md`
(enrichment in depth), `docs/deployment.md` (Docker).

## At a glance

| Command | Does | Network | Typical time |
|---|---|---|---|
| `node bin/retrieve.js` | Parse `data/workflowy.md`, classify every link, print the type counts | none | seconds |
| `node bin/retrieve.js --live` | …and GET each link (title, description, HTTP status), cached 7 days | every link, 1/s | ~2 h |
| `node bin/ingest.js` | Load bookmarks into the store (drops and reloads the source graph), then embed | cache or live | minutes + embedding |
| `node bin/enrich.js` | Fetch, summarise and patch each bookmark; optionally re-embed | every link + LLM | hours |
| `node bin/deadlinks.js` | Link-status report; `--wayback` finds archived copies | Wayback API | seconds / 1 per dead link |
| `node bin/validate.js` | SHACL-check every graph in the store | none | seconds |
| `node bin/search.js "…"` | Hybrid search from the terminal | Ollama (query embedding) | instant |
| `node bin/serve.js` | Web UI + JSON API on `:4110` | Ollama (query embedding) | — |
| `bin/pipeline.sh` | retrieve → ingest → enrich → index → validate in one go | all of the above | hours |

`npm run <name>` works for `retrieve`, `ingest`, `enrich`, `deadlinks`,
`validate`, `search`, `serve` and `pipeline`; add flags after `--`
(`npm run enrich -- --limit 50`).

## Bookmarks saved in DIM are enriched as they are saved

A bookmark saved inside DIM (Squirt capture or share, News **Save as
bookmark**) goes through the same steps as `enrich --reembed`, straight
away and in the background, one at a time: GET the page (its HTTP status is
the link check), extract, summarise, patch the store, then embed it into the
bookmark index (written a few seconds later, and on shutdown). A web page's
feeds go into the News feed inbox (`docs/commands-news.md`). Its page says
*Fetching and summarising…* until it's done; reload after a minute.

| `.env` | |
|---|---|
| `ENRICH_SUMMARISER` | `ollama` (default; `OLLAMA_URL`, model `ENRICH_CONFIG.model`), `remote` (the `LLM_*` settings), or `extractive` (offline). An LLM that fails falls back to the offline summarisers, so there's always a summary. |
| `AUTO_ENRICH=0` | off: saved bookmarks wait for the next `enrich` run |

If embedding fails (Ollama down), the bookmark is still found by its words;
the next `enrich --reembed` adds its vector. `/health` shows the queue
(`facets.gnamgnam.autoEnrich`).

## retrieve — first-pass link check

```sh
node bin/retrieve.js                  # offline: parse + classify, print distribution
node bin/retrieve.js --live           # GET every link (polite: 1 s apart, honest user-agent)
node bin/retrieve.js --live --limit 100
```

- Results go to `data/cache/retrieval.json` and stay valid for 7 days;
  `ingest` reads them from there, so a live retrieve is not repeated.
- Refusals (401, 403, 404, 410, 429, 451 and LinkedIn's 999) are recorded,
  not retried.

## ingest — load the store (and index)

```sh
node bin/ingest.js --skip-embeddings  # the usual first step: store only
node bin/ingest.js                    # store, then embed every bookmark
node bin/ingest.js --no-fetch         # classify from URLs only, no probing at all
node bin/ingest.js --only-new         # embed only bookmarks without a vector
node bin/ingest.js --only-new --limit 500
node bin/ingest.js --skip-validation  # skip the pre-write SHACL check
```

- Drops and reloads `graph:source/workflowy`, the SKOS type scheme and the
  vocabulary graph. That removes enrichment and archived-copy triples; the
  next `enrich` and `deadlinks --wayback` write them back from their caches
  (reported as `restored`), without refetching.
- Adds the URL-derived catalogue details: GitHub owner/repo, arXiv id,
  Wikipedia language/title.

## enrich — summaries, keywords, catalogue details

```sh
node bin/enrich.js --limit 50 --summariser remote --llm-only --force   # a sample to review
node bin/enrich.js --summariser remote --llm-only --only-new --quiet --reembed   # the full run
```

| Flag | Meaning |
|---|---|
| `--summariser remote` | Remote LLM(s) — see [LLM settings](#llm-settings) |
| `--summariser ollama` | Local Ollama (`OLLAMA_URL`, model `qwen2.5:3b`) — the default; slow on a CPU |
| `--summariser extractive` | Offline only: lead sentences + frequency keywords |
| `--llm-only` | Write LLM summaries or nothing; stop the run after 5 bookmarks in a row fail (spent quota). Without it, a failed LLM call falls back to the offline summariser |
| `--only-new` | Skip bookmarks that already have a summary — how a run resumes |
| `--force` | Ignore the 30-day cache and refetch (e.g. to replace offline summaries) |
| `--limit N` | Only the first N candidates (always the same N, in link-text order) |
| `--reembed` | Re-embed each newly summarised bookmark at the end (needs `nomic-embed-text:v1.5` in Ollama) |
| `--quiet` | Progress every 10 bookmarks instead of one line each |

Per-bookmark status: `enriched` (new summary), `fresh` (cached, skipped),
`unchanged` (same page text), `restored` (written back from cache after a
re-ingest), `refused` (site said 4xx), `failed` (network error or no summary).

Set `GITHUB_TOKEN` (any read-only token) before a full run: without it the
GitHub API allows 60 requests an hour and most repositories come back
`refused`.

### Overnight

```sh
nohup sh -c 'for pass in 1 2 3 4 5 6; do
  echo "=== pass $pass $(date)"
  node bin/enrich.js --summariser remote --llm-only --only-new --quiet --reembed
  sleep 900
done' > data/cache/enrich-overnight.log 2>&1 &

tail -f data/cache/enrich-overnight.log
grep -E '===|Enriched|Stopping' data/cache/enrich-overnight.log
pkill -f 'enrich.js'; pkill -f 'for pass in'        # stop
```

Each pass resumes where the last stopped; the pause lets exhausted free-tier
limits recover.

### LLM settings

In `.env`. **Rotation** (recommended): each bookmark goes to the first
provider available; a 429/503 cools that provider down and moves on,
a refused key drops it for the run.

```sh
LLM_PROVIDERS=mistral,groq,openrouter,google     # order of preference
MISTRAL_API_KEY=…
GROQ_API_KEY=…
OPENROUTER_API_KEY=…
GEMINI_API_KEY=…
# optional per provider: GROQ_MODEL=…  GROQ_BASE_URL=…  GROQ_MAX_TOKENS=…
```

| Provider | Default model | Key |
|---|---|---|
| `mistral` | `mistral-small-latest` | `MISTRAL_API_KEY` |
| `groq` | `openai/gpt-oss-20b` | `GROQ_API_KEY` |
| `openrouter` | `nvidia/nemotron-3-super-120b-a12b:free` | `OPENROUTER_API_KEY` |
| `google` | `gemini-flash-latest` | `GEMINI_API_KEY` |
| `huggingface` | `meta-llama/Llama-3.3-70B-Instruct` | `HF_TOKEN` |
| `nvidia` | `openai/gpt-oss-20b` | `NVIDIA_API_KEY` |

**Single endpoint** (used when `LLM_PROVIDERS` is unset): `LLM_BASE_URL`,
`LLM_API_KEY`, `LLM_MODEL`, optional `LLM_MAX_TOKENS`.

Tuning lives in `config/preferences.js` → `ENRICH_CONFIG`: request spacing
(`remoteRequestIntervalMs`), retries and backoff (`remoteMaxRetries`,
`remoteRetryBaseMs`, `remoteRetryCapMs`), the longest wait per bookmark when
every provider is busy (`rotationMaxWaitMs`), text sent per request
(`llmInputChars`), reply budget (`llmMaxTokens`).

Page text is sent to the provider; free tiers may keep or train on it.

Check a provider by hand without leaking `.env` into your shell:

```sh
( set -a; . ./.env; set +a
  curl -s https://api.groq.com/openai/v1/chat/completions -H "Authorization: Bearer $GROQ_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"Say hi"}],"max_tokens":200}' | head -c 400 )
```

## topics — a topic filter from what enrichment learnt

```sh
node bin/topics.js --dry-run          # the topics it would make, biggest first, with ⊂ nesting
node bin/topics.js                    # write them (graph:alignment/topics); restart the server
node bin/topics.js --min-docs 5 --max-topics 120 --per-bookmark 2
```

Topics come from enrichment keywords (run `enrich` first; without keywords
there's little to go on), GitHub topics, arXiv categories and your tags:

- **Kept:** terms used by at least `--min-docs` bookmarks (8) and at most a
  quarter of them. Domains never count; they have their own filter.
- **Merged:** spellings merge (`knowledge-graphs` = `knowledge graph`),
  and a plural joins its singular when both are used.
- **Nested:** a topic whose bookmarks are 80% inside a bigger one becomes
  narrower than it (SKOS `broader`).
- **Assigned:** each bookmark gets its most specific topics.

- **Beyond bookmarks:** the same topics then go to wiki pages, tasks,
  outline items, published posts and recent news items whose text names
  them (a name in the title, or twice in the text).

It is rebuilt from scratch each run, so rerun it after more enrichment.
Then:

- GnamGnam's search has a **Topic** filter (`?topic=`).
- `/topics` shows the scheme as a tree.
- `/topics/<topic>` gathers everything on one topic, from every facet.
- Detail pages list their topics under **Related**.
- A tag with the same name as a topic links to it.

## deadlinks — link health and archived copies

```sh
node bin/deadlinks.js                     # counts for every status + the dead ones
node bin/deadlinks.js --status blocked    # ok | dead | blocked | error | unchecked
node bin/deadlinks.js --json > dead.json
node bin/deadlinks.js --wayback           # find Wayback Machine copies for dead links
node bin/deadlinks.js --wayback --force   # ask again, ignoring cached answers
```

- Status comes from the last HTTP status seen (enrichment fetch, else the
  first-pass probe): `dead` = 404/410, `blocked` = 401/403/429/451 or a
  non-standard code such as 999, `error` = other 4xx/5xx.
- `--wayback` asks 1 per second, caches every answer (including "none") in
  `data/cache/wayback.json`, and writes `schema:archivedAt`. Re-run it after a
  re-ingest to restore the links from the cache.

## validate — SHACL

```sh
node bin/validate.js                              # every registered graph
node bin/validate.js --graph graph:source/workflowy --verbose
```

## search — from the terminal

```sh
node bin/search.js "modular synth DIY"
node bin/search.js "paper" --bookmarkType arxiv-paper
node bin/search.js "rdf" --domain github.com
node bin/search.js --facets
```

## serve — web UI and API

```sh
node bin/serve.js                  # http://localhost:4110/ → /gnamgnam/
PORT=4111 node bin/serve.js
```

| URL | |
|---|---|
| `/gnamgnam/?q=…&bookmarkType=…&domain=…&linkStatus=…` | search page |
| `/gnamgnam/bookmark/<slug>` | detail page (`.json`, `.ttl` for data) |
| `/gnamgnam/search?q=…` | JSON results |
| `/gnamgnam/facets` | facet counts |
| `/find?q=…` | search every facet |
| `/health` | per-facet status |

The server loads bookmarks and vectors at start: restart it after an
ingest or enrich run. Notes, tags and links do not need a restart.

### Notes, tags and links

Set a write token in `.env` (16+ characters), restart, and log in at
`/login` with it:

```sh
DIM_WRITE_TOKEN=$(openssl rand -base64 24)      # put the value in .env
```

A bookmark's page then has **Your tags and note** (Markdown; `[[bookmark/slug]]`
or `[[Title]]` link to other things) and **Links** (related / resources /
part of, with a type-ahead picker, or paste a URL). From a script:

```sh
( set -a; . ./.env; set +a
  curl -s -X POST localhost:4110/gnamgnam/bookmark/<slug>/annotations \
    -H "Authorization: Bearer $DIM_WRITE_TOKEN" -H 'Content-Type: application/json' \
    -d '{"tags":"synth, diy","note":"See [[bookmark/other-slug]]"}'
  curl -s -X POST localhost:4110/links -H "Authorization: Bearer $DIM_WRITE_TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"from":"/gnamgnam/bookmark/<slug>","kind":"resource","to":"https://github.com/…"}' )
```

These live in `graph:facet/gnamgnam` and `graph:facet/links`, which an
ingest never drops. Every change is recorded in `graph:system/changes`.

## pipeline — everything in one go

```sh
bin/pipeline.sh --live --summariser remote            # retrieve → ingest → enrich (+ re-embed) → index → validate
bin/pipeline.sh --limit 200 --summariser extractive   # bounded, offline summaries
bin/pipeline.sh --no-reembed --skip-validate
```

It does not run `deadlinks --wayback`; do that afterwards. Enrichment inside
the pipeline does not use `--llm-only`.

## Caches (all in `data/cache/`, gitignored)

| File | Written by | Lifetime |
|---|---|---|
| `retrieval.json` | `retrieve --live`, `ingest` | 7 days |
| `enrichment.json` + `enrichment/*.txt` | `enrich` | 30 days |
| `wayback.json` | `deadlinks --wayback` | until deleted |
| `enrich-overnight.log` | the overnight loop above | — |

The vector index is `data/dim.index` (+ `.json`); delete both and run
`node bin/ingest.js --only-new` to rebuild it.
