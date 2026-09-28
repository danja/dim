# Backup and restore

The store holds work that exists nowhere else: the wiki, tasks, outlines as
edited, notes, links, tags, news subscriptions, blog posts and the change
log. Three layers keep it safe:

1. **A snapshot** on this machine, every night: `bin/backup.js`.
2. **A check** of that snapshot, every night: `bin/restore.js latest --check`.
3. **A copy somewhere else**, encrypted: restic (or rsync).

The first two guard against mistakes (a bad import, a deleted page). Only
the third survives a dead disk or a lost laptop. You need all three.

## What a backup holds

`data/backups/<time>/`:

| File | What | Why |
|---|---|---|
| `store.trig.gz` | every named graph, as TriG | the data itself; readable by any RDF tool, no DIM needed |
| `data/dim.index`, `data/related.index` (+ `.json`), `data/related.state.json` | the vector indexes | can be rebuilt, but embedding everything again takes hours on a CPU |
| `cache/` (with `--with-cache`) | enrichment and retrieval caches | saves refetching and re-summarising pages |
| `manifest.json` | when it was made, what's in it, the store file's checksum | restore and check refuse a file that doesn't match |

What it doesn't hold: `.env`. That file has the store password and
`DIM_WRITE_TOKEN`, and shouldn't sit beside the data. Keep a copy in a
password manager. `data/workflowy.md` is in git.

## Making backups

```sh
node bin/backup.js                  # → data/backups/<time>/, keeps the newest 14
node bin/backup.js --keep 30
node bin/backup.js --with-cache
BACKUP_DIR=/mnt/backups/dim node bin/backup.js
```

With Docker, backups go to `./backups` on the host (`BACKUP_HOST_DIR`). The
directory must be writable by the container's user:

```sh
mkdir -p backups && sudo chown 1001:1001 backups
docker compose run --rm app node bin/backup.js
```

## Checking them

```sh
node bin/restore.js --list              # every backup, its age and size
node bin/restore.js latest --check      # checksum, parse, triples per graph beside the live store
```

`--check` changes nothing. It reads the store file and prints each graph's
triple count next to the live store's; differences show since when the store
has moved on (or what a backup is missing). Straight after a backup every
line should match. It exits non-zero when the backup is unreadable, so a
nightly chain stops there rather than copying a bad backup off the machine.

`/health` shows how old the newest backup is (`backups.status` is `stale`
after 48 hours, `BACKUP_STALE_HOURS`). It doesn't make the app "degraded";
that would make Docker restart a healthy app over a missed backup.

## Restoring

Every restore first saves the current state as a `…-pre-restore` backup, so
a restore can itself be undone. Restart the server afterwards: it caches in
memory. `latest` means the newest regular backup, never a pre-restore copy.

**One facet, leaving the rest as it is.** You broke the wiki on Tuesday; put
back Monday's wiki without losing Tuesday's tasks:

```sh
node bin/restore.js latest --check                   # see what differs
node bin/restore.js latest --graph wiki              # shows what it would replace
node bin/restore.js latest --graph wiki --yes
```

A name matches every graph ending in it (`news` is both `graph:facet/news`,
your subscriptions, and `graph:source/news`, the items); a full IRI matches
just that graph. Repeat `--graph` for several. The vector indexes are left
alone (the next related sync picks up any changed text).

**Everything.** The whole store is replaced, and the vector indexes too:

```sh
node bin/restore.js 20260927-031700Z             # shows what it would replace
node bin/restore.js 20260927-031700Z --yes
node bin/restore.js 20260927-031700Z --yes --store-only    # leave the indexes
node bin/restore.js 20260927-031700Z --yes --with-cache
```

## Off this machine: restic

[restic](https://restic.net) encrypts, deduplicates (nightly dumps are
mostly the same, so they cost little) and keeps history, to another machine
over SFTP, a USB disk, or cloud storage (Backblaze B2, S3, …). This is
personal data, so encryption matters.

Once:

```sh
sudo apt install restic
export RESTIC_REPOSITORY=sftp:you@otherbox:/srv/restic/dim   # or b2:bucket:dim, /media/usb/restic-dim, …
export RESTIC_PASSWORD_FILE=~/.config/dim/restic-password    # keep this password in your password manager too
restic init
```

Nightly, from the host's crontab (`crontab -e`), all three layers:

```
RESTIC_REPOSITORY=sftp:you@otherbox:/srv/restic/dim
RESTIC_PASSWORD_FILE=/home/you/.config/dim/restic-password
17 3 * * *  cd /path/to/dim && (node bin/backup.js && node bin/restore.js latest --check && restic backup --tag dim data/backups && restic forget --tag dim --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune) >> data/backups/backup.log 2>&1
```

Each step runs only if the one before worked. Look at `backup.log` now and
then, or at `/health`, which says when backups have stopped.

(With Docker: `docker compose run --rm app node bin/backup.js`, the same
for the check, and `restic backup backups`.)

Getting it back on a new machine:

```sh
restic snapshots --tag dim
restic restore latest --tag dim --target /tmp/dim-restore
node bin/restore.js /tmp/dim-restore/path/to/dim/data/backups/<time> --yes
```

Plainer, if restic is too much: `rsync -a data/backups/ otherbox:dim-backups/`
(or `rclone sync` to cloud storage). Neither encrypts nor keeps history
beyond the 14 backups, so point them only at storage you trust.

## Restore drill

Rehearse once, and again after upgrades:

1. `node bin/backup.js`, then `node bin/restore.js latest --check`: every line matches.
2. Break something:
   `curl -s -u admin:$SPARQL_PASSWORD localhost:3031/dim/update --data-urlencode 'update=DROP GRAPH <graph:facet/wiki>'`.
3. `node bin/restore.js latest --check` shows the wiki missing.
4. `node bin/restore.js latest --graph wiki --yes`; check again: every line matches.
5. Once in a while, the whole thing from the off-machine copy, onto a spare
   store.

(Rehearsed 2026-09-27 on a 16-graph, 146k-triple store: deleted wiki
titles came back while a task added after the backup stayed; the check
showed both differences beforehand. A whole-store restore of 17 graphs,
2026-09-26, took about 11 s.)
