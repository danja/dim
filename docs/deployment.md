# Deployment

Getting DIM running locally, and harvesting once it is there.

The method is `~/github/plugin-universe` (`docs/deployment.md` there):
same images, same volume layout, same loopback-only publishing. This is
the DIM runbook — localhost in the first instance, so no nginx profile.

## What runs

| Container | Purpose | Exposed |
|---|---|---|
| `fuseki` | Apache Jena Fuseki, TDB2. The store. | loopback `:3031` only |
| `ollama` | Embeddings (`nomic-embed-text:v1.5`) | loopback `:11434` only |
| `app` | The Node service: search UI, JSON API, content negotiation | loopback `:4110` only |

Nothing is reachable from outside. Fuseki in particular has an update
endpoint, and publishing that by accident would be the single worst
mistake available here — hence the `127.0.0.1:` prefixes in the compose
file.

## Requirements

- Docker with Compose v2
- 4 GB of RAM is enough; the defaults in `docker-compose.yml` are sized
  for it and overridable from `.env` (see the memory note at the top of
  the compose file for where the figures come from).
- Disk for the store, the embedding model and the index.

## First run

```sh
cp .env.example .env
```

Fill in `.env`. Every value is required — there are no fallbacks, and a
missing one is an error rather than a silent default.
`SPARQL_URL_BASE` and `OLLAMA_URL` are only used when running outside
Docker; compose sets them to the service names.

```sh
docker compose up -d fuseki ollama
docker compose exec ollama ollama pull nomic-embed-text:v1.5
```

Pulling the model is a few hundred megabytes and only happens once; it
lives in the `ollama-models` volume. The summariser model for enrichment
(`qwen2.5:3b`, see `config/preferences.js` `ENRICH_CONFIG`) is pulled the
same way when needed:

```sh
docker compose exec ollama ollama pull qwen2.5:3b
```

The `dim` dataset is created by the assembler that compose mounts, so
there is nothing to create by hand — doing it through `/$/datasets`
would make a second, differently configured one. Confirm it is there:

```sh
curl -s -u "admin:$SPARQL_PASSWORD" http://localhost:3031/\$/datasets \
  | grep -o '"ds.name" : "[^"]*"'
```

`/dim` is ours. `/ds` also appears — the image ships its own default
dataset and it is harmless, unused and empty.

Then build and start the app:

```sh
docker compose up -d --build app
docker compose exec app node -e "fetch('http://localhost:4110/health').then(r=>r.text()).then(console.log)"
```

`/health` reports per-facet status; `facets.gnamgnam` has the corpus and index sizes. Both are zero until the
first ingest.

## Harvesting and enriching

> **After any `git pull`, rebuild before running anything.** The
> Dockerfile copies the source into the image, so `docker compose run`
> executes the code that was baked in at build time — not what is in the
> checkout. A pull with no rebuild silently runs the old version.
>
> ```sh
> git pull && docker compose build app && docker compose up -d app
> ```

Commands run against the same image and the same volume as the service,
so the index they build is the index the app serves:

```sh
docker compose run --rm app node bin/ingest.js --no-fetch --skip-embeddings
docker compose restart app
```

The store is now populated and searchable — **lexical search works
without any vectors at all**, so this is a usable state rather than a
broken one. Then converge the vectors in the background (`--only-new`
resumes via checkpoints; the full set takes hours on CPU-only Ollama):

```sh
docker compose run --rm app node bin/ingest.js --only-new --limit 200
docker compose restart app
```

Second-pass enrichment (docs/enricher.md) follows the same pattern —
sample first, review, then run wide:

```sh
docker compose run --rm app node bin/enrich.js --limit 50 --summariser extractive
docker compose run --rm app node bin/enrich.js --only-new --reembed --limit 200
docker compose restart app
```

The app loads documents and the index once at start, not per request,
so restart it after any ingest or re-embed.

Validate every registered graph against `vocabs/shapes.ttl`:

```sh
docker compose run --rm app node bin/validate.js
```

## Backups

Harvested graphs are reproducible from source, so they are not what
needs backing up. What is irreplaceable is curation and any enrichment
cache you would rather not re-fetch:

```sh
docker compose exec fuseki /jena-fuseki/bin/tdb2.tdbdump \
  --loc /fuseki-base/databases/dim > backup-$(date +%F).nq
```

A weekly dump is ample.

## Operating notes

- **Watch the limits before trusting them.**
  `docker stats --no-stream` after a day of real use says whether the
  defaults fit your host. A container that keeps hitting its ceiling is
  killed and restarted, which looks like a mysterious outage rather than
  a memory problem.
- **Harvest politely.** `config/preferences.js` holds the request
  interval and the crawler's user agent. Enrichment GETs every bookmark
  target — pace it, and fix the contact address if it stops working
  before the next sweep.
