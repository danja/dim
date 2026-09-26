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

## Settings

Beyond the store and model settings above, all optional (`.env`):

| Variable | Does |
|---|---|
| `DIM_WRITE_TOKEN` | 16+ characters; enables logging in and every write |
| `DIM_PRIVATE=1` | every page needs a login (not just writes). **Set it whenever DIM is reachable from anything but this machine.** |
| `DIM_ORIGIN` | the address DIM is reached at, e.g. `https://dim.example.ts.net`; used in feeds and the bookmarklet, and makes the session cookie https-only |
| `NEWS_POLL_MINUTES` | poll due feeds from the server every N minutes |
| `BLOG_TITLE`, `BLOG_AUTHOR`, `BLOG_BASE_URL` | blog name, author, public URL of the static export |
| `LOG_LEVEL`, `LOG_FORMAT=json`, `LOG_REQUESTS=1` | logging (below) |
| `BACKUP_DIR` (tools), `BACKUP_HOST_DIR` (compose) | where backups go |

## Reaching DIM from your phone (https)

DIM listens on loopback only. To use it from a phone, put an https proxy in
front of it. Browsers only install the app, run its service worker and share
into it over https.

**Tailscale** (simplest; only your own devices can reach it):

```sh
tailscale serve --bg 4110          # https://<machine>.<tailnet>.ts.net → localhost:4110
```

**Caddy**, on a host with a public name:

```
dim.example.org {
    reverse_proxy 127.0.0.1:4110
}
```

Either way, set these in `.env` and restart:

```sh
DIM_ORIGIN=https://<machine>.<tailnet>.ts.net
DIM_PRIVATE=1
```

Never publish Fuseki (`:3031`) or Ollama. Only the app goes through the
proxy. See `docs/security.md`.

## Backups

The store holds work that exists nowhere else: the wiki, tasks, outlines as
edited, notes, links, news subscriptions, blog posts. Back it up.

```sh
node bin/backup.js                         # store (all graphs, TriG, gzipped) + vector index → data/backups/<time>/
node bin/backup.js --with-cache            # …and data/cache (enrichment/retrieval caches)
node bin/backup.js --keep 30               # keep the newest 30 (default 14)
node bin/restore.js --list
node bin/restore.js <backup> --yes         # REPLACES the store; saves the current state first
node bin/restore.js <backup> --yes --store-only
```

With Docker, backups go to `./backups` on the host (`BACKUP_HOST_DIR`). The
directory must be writable by the container's user:

```sh
mkdir -p backups && sudo chown 1001:1001 backups
docker compose run --rm app node bin/backup.js
```

Nightly, from the host's crontab (`crontab -e`):

```
17 3 * * *  cd /path/to/dim && docker compose run --rm app node bin/backup.js >> backups/backup.log 2>&1
```

Each backup has a `manifest.json` with a checksum. Restore refuses a store
file that doesn't match it.

**Restore drill.** Rehearse this once, and again after upgrades:

1. `node bin/backup.js`.
2. Count triples per graph:
   `curl -s -u admin:$SPARQL_PASSWORD localhost:3031/dim/query --data-urlencode 'query=SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY ?g' -H 'Accept: text/csv' > before.csv`
3. Break something, for example
   `curl -s -u admin:$SPARQL_PASSWORD localhost:3031/dim/update --data-urlencode 'update=DROP GRAPH <graph:facet/wiki>'`.
4. `node bin/restore.js <that backup> --yes`, then count again into
   `after.csv` and `diff before.csv after.csv` — no difference.
5. Restart the app (it caches in memory).

(Rehearsed 2026-09-26 on a 17-graph store: identical counts; the restore
took about 11 s.)

## Health and logs

- **`/health`** returns 200 `ok`, or 503 `degraded` when the store is
  unreachable or a facet fails. It gives per-facet counts; with
  `DIM_PRIVATE`, strangers see only the status. Compose checks it every 30 s.
- **Logs** go to the console, which is Docker's log. `LOG_FORMAT=json`
  writes one JSON object per line, for a log collector. `LOG_REQUESTS=1`
  adds a line per request (method, path, status, time).
  `LOG_LEVEL=debug` shows more.

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
