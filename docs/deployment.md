# Deployment

Getting DIM running locally, and harvesting once it is there.

This is the DIM runbook: one `docker-compose.yml`, everything published on
loopback only, state in named volumes, and every setting in `.env` with no
fallbacks. DIM runs on localhost in the first instance, so there is no nginx
profile; to reach it from a phone, see "Reaching DIM from your phone"
below. All commands run from the repository directory.

> **Note: this instance runs under systemd**, not as the `app` container.
> The `dim` unit (`deploy/dim.service`, see "Starting at boot") starts
> Fuseki and Ollama with Docker, then runs `node bin/serve.js` on :4110.
>
> ```sh
> systemctl status dim              # is it running?
> sudo systemctl restart dim        # after git pull, or after a CLI tool writes to the store
> sudo systemctl stop dim           # / start dim
> journalctl -u dim -f              # follow the log
> journalctl -u dim -n 100 --no-pager
> ```
>
> Don't also start the `app` container: both use :4110.

## Deploying DIM

The short version, for a machine with Docker (Compose v2) and about 4 GB of
RAM. Each step is explained further down.

1. **Get the code and make your settings file.**

   ```sh
   git clone https://github.com/danja/dim.git && cd dim
   cp .env.example .env
   ```

   Edit `.env`. Change `SPARQL_PASSWORD` from the example's `admin` before
   the first start, and set `DIM_WRITE_TOKEN` (16+ characters, for example
   `openssl rand -base64 24`), which is what lets you log in and write.
   Leave the rest unless you know you need it.

2. **Start the store and the embedder.**

   ```sh
   docker compose up -d --wait fuseki ollama
   docker compose exec ollama ollama pull nomic-embed-text:v1.5   # once
   ```

3. **Let the app write backups.** The app runs as uid 1001:

   ```sh
   mkdir -p backups && sudo chown 1001:1001 backups
   ```

4. **Build and start the app.**

   ```sh
   docker compose up -d --build app
   ```

5. **Check it.**

   ```sh
   curl -s http://localhost:4110/health
   ```

   It answers `ok` with a count for each facet. Then open
   http://localhost:4110/ and log in with the token. A fresh store is
   empty: start saving things in the web UI, or load what you already have
   with the tools in "Harvesting and enriching" below.

All three containers restart on their own after a reboot (`restart:
unless-stopped`), and everything is published on loopback only, so nothing
is reachable from other machines yet.

**To update:** `git pull && docker compose build app && docker compose up -d app`.
Rebuilding is not optional, because the image holds a copy of the source.

**To run the app on the host instead** (Node 20.11 or later, data in
`./data`, started at boot by systemd): do steps 1 and 2 with `npm install`
after the clone, skip steps 3 and 4, and follow "Starting at boot". Use that
or the container, never both: each wants :4110.

**Before reaching DIM from a phone or anywhere but this machine,** read
"Reaching DIM from your phone (https)" and set `DIM_PRIVATE=1`. Set up
backups from `docs/backup.md`.

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
  for it and overridable from `.env`. See "Memory" below.
- Disk for the store, the embedding model and the index.

### Memory

Every limit is set in `docker-compose.yml` and overridable from `.env`:

| Container | Limit | Swap | Why |
|---|---|---|---|
| `fuseki` | `FUSEKI_MEM` 1400m, heap `FUSEKI_HEAP` 1g | none | TDB2 memory-maps its indexes and relies on the OS page cache, not the Java heap. A bigger `-Xmx` doesn't help it and takes memory the page cache would use better. Raise it only with a measurement in hand. |
| `ollama` | `OLLAMA_MEM` 1600m | none | One small model, one request at a time (`OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`). |
| `app` | `APP_MEM` 384m, heap `NODE_HEAP` 256 | up to `APP_MEMSWAP` 640m | The working set is the document map and a few megabytes of vector index. Node's cold pages are what swap is good for, and a stalled web tier recovers. |

The limits add up to about 3.4 GB, which is what fits a 4 GB host. If the
app is killed during a sync, raise `NODE_HEAP`, `APP_MEM` and `APP_MEMSWAP`
(for example `1024`, `1536m`, `2g`).

**Ollama is a serving dependency, not only a batch one.** Search embeds the
query text, so a text search fails without it. The cost per query is small;
the memory is the model sitting resident. `OLLAMA_KEEP_ALIVE` (default 30m)
keeps it loaded during active use and releases it overnight, at the price of
a second or two on the first search after an idle spell.

**No swap for the store or the embedder** (`memswap_limit` equals
`mem_limit`) is deliberate. A JVM garbage collection walks the whole live
heap, so a paged-out heap turns a collection into a disk I/O storm, and
Ollama reads its model weights on every forward pass. Both must stay
resident. Swap's job is to absorb cold pages elsewhere on the host and keep
the OOM killer away from the store, so a small host should have some:

```sh
sudo fallocate -l 4G /swapfile        # btrfs needs different handling
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

`swappiness=10` matters: the default of 60 swaps anonymous memory fairly
eagerly, which is what to avoid with a JVM present. `zram` (compressed swap
in RAM, no disk I/O) is a good alternative.

Docker needs cgroup v2, or `swapaccount=1` on a cgroup v1 kernel, to honour
`memswap_limit`. Where it can't, it warns and ignores the setting instead of
failing, so check the output of the first `docker compose up`.

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

Backups are written to `./backups` on the host (`BACKUP_HOST_DIR`), and
the app runs as uid 1001, so give it that directory once (see
`docs/backup.md`):

```sh
mkdir -p backups && sudo chown 1001:1001 backups
```

Then build and start the app:

```sh
docker compose up -d --build app
docker compose exec app node -e "fetch('http://localhost:4110/health').then(r=>r.text()).then(console.log)"
```

`/health` reports per-facet status; `facets.gnamgnam` has the corpus and index sizes. Both are zero until the
first ingest.

To log in and write (notes, tags, tasks, the Calendar), set
`DIM_WRITE_TOKEN` in `.env` (16+ characters) and recreate the app:
`docker compose up -d app`. Then open http://localhost:4110/ and log in
with the token.

## Starting at boot

To run the app on the host (Node, data in `./data`) rather than as the
`app` container, `deploy/dim.service` is a systemd unit for it. It requires
Docker, brings up `fuseki` and `ollama` (`docker compose up -d --wait`),
then runs `node bin/serve.js` as your user, restarting on failure.
Settings come from `.env`.

Before installing, edit `User`, `WorkingDirectory` and the `node` path
(with nvm the path contains the Node version, so update it when the
version changes). The user must be in the `docker` group.

```sh
sudo cp deploy/dim.service /etc/systemd/system/dim.service
sudo systemctl daemon-reload
sudo systemctl enable --now dim
systemctl status dim
journalctl -u dim -f
```

After `git pull`: `sudo systemctl restart dim`. Don't run the `app`
container as well; both use :4110. (The containers themselves have
`restart: unless-stopped`, so Docker alone brings the `app` container
back at boot if you prefer that route.)

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
```

Second-pass enrichment (docs/enricher.md) follows the same pattern —
sample first, review, then run wide:

```sh
docker compose run --rm app node bin/enrich.js --limit 50 --summariser extractive
docker compose run --rm app node bin/enrich.js --only-new --reembed --limit 200
```

The app holds bookmark texts and vectors in memory. When a tool saves the
bookmark index (an ingest that embeds, `enrich --reembed`) the app reloads
both within a minute, and its own later saves merge with the tool's rather
than overwrite them. After a run that saves no vectors (`ingest
--skip-embeddings`, `enrich` without `--reembed`), restart the app to see
the new text: `docker compose restart app`.

Validate every registered graph against `vocabs/shapes.ttl`:

```sh
docker compose run --rm app node bin/validate.js
```

## Indexing and the feed finder

Most of this happens by itself once the app is running:

| When | What happens | Setting |
|---|---|---|
| A bookmark is saved in DIM (Squirt capture or share, News **Save as bookmark**) | Its page is fetched (the link check), summarised and embedded in the background; if it's a web page, the feeds it offers go into the feed inbox on **Manage feeds** | `ENRICH_SUMMARISER`, `AUTO_ENRICH` |
| Every `RELATED_SYNC_MINUTES` (30) | New and changed wiki pages, posts, tasks, outline items and news items are embedded into the related index, which serves **Find**, Related panels and News **For you** | `RELATED_SYNC_MINUTES` |
| Every `NEWS_POLL_MINUTES` | Due feeds are polled; failing ones are set aside | `NEWS_POLL_MINUTES` |

By hand, after a first install, an upgrade that widens what is indexed, or
a large import. Use `docker compose exec` (not `run`) so the tool runs
alongside the server in the same container:

```sh
# Everything not yet in the related index. The first run is long on a CPU
# (about 1–2 s per item); it prints a total and an estimate, saves every 200,
# and can be stopped and run again. A lock keeps it and the server's own
# sync from running at once; the server picks up the result at its next sync.
docker compose exec app node bin/related.js            # --limit 1000, --status

# Bookmarks saved before automatic enrichment, or ones that failed. The app
# picks up the new summaries and vectors within a minute of each save.
docker compose exec app node bin/enrich.js --only-new --reembed --summariser remote

# Feeds on bookmarks you already had: sites in parallel, one page at a time
# per site, only the start of each page, at most 3 pages per site (stopping
# at the first with a feed). Resumable; suggestions show on Manage feeds
# within a minute, no restart needed.
docker compose exec app node bin/feed-scan.js --dry-run --limit 50
docker compose exec app node bin/feed-scan.js          # --limit N, --rescan

# Topic concepts from enrichment keywords (after a big enrichment run).
docker compose exec app node bin/topics.js --dry-run
```

**Several writers, one index.** The server and the tools can save the
bookmark index (`data/dim.index`) at the same time: each save takes a short
lock, and if another process saved since, it reloads that and re-applies
its own changes, so nobody's vectors are lost. The server looks for saves by
the tools every minute.

**Use `exec`, not `run`, for `bin/related.js`.** Its lock (held for the
whole sync, not just a save) records a process id, and a `docker compose
run` container can't see the server's processes, so the lock can't stop two
syncs running at once.

Where it all lives: the `app-data` volume (`/app/data`), not `./data` on the
host.

| File | What | Backed up |
|---|---|---|
| `dim.index` (+ `.json`) | bookmark vectors | yes |
| `related.index` (+ `.json`), `related.state.json` | everything else's vectors, and what has been embedded | yes |
| `cache/enrichment.json`, `cache/enrichment/` | fetched text and summaries (30 days) | with `bin/backup.js --with-cache` |
| `cache/feed-scan.json` | pages the feed finder has looked at | with `--with-cache` |
| `sessions.json` | login sessions | never |

To bring indexes built outside Docker into the volume, for example after
running `bin/related.js` on the host:

```sh
docker compose stop app
for f in dim.index dim.index.json related.index related.index.json related.state.json; do
  docker compose cp data/$f app:/app/data/$f
done
docker compose run --rm --user root app sh -c 'chown 1001:1001 /app/data/*.index* /app/data/related.state.json'
docker compose up -d app
```

The model must be pulled in the compose Ollama for any of this:
`docker compose exec ollama ollama pull nomic-embed-text:v1.5`. Embedding
is slow on a CPU, so large runs are best started by hand as above rather
than left to the server's sync. If the app is killed while a sync runs,
raise `NODE_HEAP` and `APP_MEM` (see "Memory" above).

## Settings

Beyond the store and model settings above, all optional (`.env`):

| Variable | Does |
|---|---|
| `DIM_WRITE_TOKEN` | 16+ characters; enables logging in and every write |
| `DIM_PRIVATE=1` | every page needs a login (not just writes). **Set it whenever DIM is reachable from anything but this machine.** |
| `DIM_ORIGIN` | the address DIM is reached at, e.g. `https://dim.example.ts.net`; used in feeds and the bookmarklet, and makes the session cookie https-only |
| `NEWS_POLL_MINUTES` | poll due feeds from the server every N minutes |
| `RELATED_SYNC_MINUTES` | keep the cross-facet related index in step every N minutes (default 30; 0 = off; `bin/related.js` by hand) |
| `ENRICH_SUMMARISER` | summariser for bookmarks enriched as they are saved: `ollama` (default), `remote` (the `LLM_*` settings) or `extractive` (offline); an LLM that fails falls back to the offline one |
| `AUTO_ENRICH=0` | don't fetch, summarise and embed bookmarks as they are saved (leave them for `bin/enrich.js`); this also turns off the feed finder for new bookmarks |
| `NODE_HEAP`, `APP_MEM`, `APP_MEMSWAP`, `FUSEKI_MEM`, `FUSEKI_HEAP`, `OLLAMA_MEM`, `OLLAMA_KEEP_ALIVE` | container memory and model residency; see "Memory" above. Raise the app's to e.g. `1024` / `1536m` / `2g` if it restarts during a sync |
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

See `docs/backup.md`: nightly snapshots (`bin/backup.js`), a check of each
(`bin/restore.js latest --check`), a copy off the machine (restic), and
restoring everything or one facet's graphs.

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
