# DIM

This will be a knowledgebase and toolset with many different facets that uses a shared core built from a SPARQL store and an embedding index.

The first task will be to identify the core features of ~/github/plugin-universe and make a copy in this repo. 

The system should be built into a Docker container and run on localhost in the first instance.


The dataset we want to build first will be derived from the file data/workflowy.md

 A versatile retrieval agent will do a GET on each of the links in the source file and first-pass determine the type of the target, this initial info will got into the SPARQL store as an instance of bookmark with its associated URL and link text. We will want to use a SKOS-based cataloging system on the retrieved data so any auxiliary info that might be useful (eg. if the link is a github repo, an arxiv paper etc).

## Status (2026-09-08)

- Core ported from `~/github/plugin-universe`: SPARQL store (Fuseki TDB2,
  named graph per source, SHACL), persisted FAISS index, Ollama embeddings,
  hybrid lexical+vector search, read-only API + UI, Docker Compose.
- Dataset: 5,121 bookmarks from `data/workflowy.md` (5,136 unique URLs, 15
  non-http rejected) in `graph:source/workflowy`, CC0. First-pass typing is
  URL-heuristic SKOS concepts (`dim:bookmark-types`, 14 concepts: webpage 2989,
  github-repo 991, wikipedia-article 398, docs 235, arxiv-paper 170, …).
- Live GET probing (`bin/retrieve.js --live`, cached 7 days) implemented but
  not yet run over the full set; stored titles/descriptions are null until then.
- Services on localhost: Fuseki :3031, app :4110 (`/health` → 5121 bookmarks).
  Full vector index converging in background (`--only-new` resumes via
  checkpoints); lexical is the primary signal until live descriptions land.
  `minSimilarity` stays 0.58 — measured nonsense scores 0.562 on this corpus,
  so lowering it buys noise, not recall.


