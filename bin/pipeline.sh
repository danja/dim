#!/bin/sh
# DIM full pipeline: retrieve → ingest → enrich (summaries) → index → validate.
#
# Usage:
#   bin/pipeline.sh [--limit N] [--live] [--summariser ollama|extractive]
#                   [--no-reembed] [--skip-validate]
#
#   --limit N      bound the enrich + index stages (grows to full across runs)
#   --live         ingest probes each URL live (default: --no-fetch, classify only)
#   --summariser   enrich summariser; extractive is offline/deterministic (default)
#   --no-reembed   skip re-embedding enriched rows (default re-embeds; needs Ollama)
#   --skip-validate  skip the final SHACL pass
#
# Re-runs resume: the probe, enrichment and vector-index caches mean each
# stage only does new work. After any `git pull`, rebuild the image first —
# it runs the code baked in at build time, not the checkout. Restart the app
# afterwards: it loads documents + index once at start.

set -eu
cd "$(dirname "$0")/.."

LIMIT_N=""
LIVE=0
SUMMARISER="extractive"
REEMBED=1
VALIDATE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT_N="$2"; shift 2 ;;
    --live) LIVE=1; shift ;;
    --summariser) SUMMARISER="$2"; shift 2 ;;
    --no-reembed) REEMBED=0; shift ;;
    --skip-validate) VALIDATE=0; shift ;;
    -h|--help) sed -n '2,/^$/p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

case "$SUMMARISER" in
  ollama|extractive) ;;
  *) echo "--summariser must be ollama|extractive, got '$SUMMARISER'" >&2; exit 1 ;;
esac

# Optional args, split intentionally (SC2086).
LIMIT_ARG=""
if [ -n "$LIMIT_N" ]; then LIMIT_ARG="--limit $LIMIT_N"; fi
FETCH_ARG="--no-fetch"
if [ "$LIVE" -eq 1 ]; then FETCH_ARG=""; fi

stage () {
  echo ""
  echo "=== [$1] $(date '+%H:%M:%S') ==="
}

# shellcheck disable=SC2086
stage "1/5 retrieve (first-pass report)"
node bin/retrieve.js

# shellcheck disable=SC2086
stage "2/5 ingest (store graphs, no vectors yet)"
node bin/ingest.js $FETCH_ARG --skip-embeddings

# shellcheck disable=SC2086
stage "3/5 enrich (GET targets, summarise, patch store)"
if [ "$REEMBED" -eq 1 ]; then
  node bin/enrich.js --summariser "$SUMMARISER" --reembed $LIMIT_ARG
else
  node bin/enrich.js --summariser "$SUMMARISER" $LIMIT_ARG
fi

# shellcheck disable=SC2086
stage "4/5 index (embed every bookmark missing a vector)"
node bin/ingest.js --only-new $LIMIT_ARG

if [ "$VALIDATE" -eq 1 ]; then
  stage "5/5 validate (SHACL over every graph)"
  node bin/validate.js
fi

echo ""
echo "Pipeline done. Restart the app so it reloads documents + index:"
echo "  docker compose restart app   # or restart node bin/serve.js"
