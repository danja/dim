# DIM

This will be a knowledgebase and toolset with many different facets that uses a shared core built from a SPARQL store and an embedding index.

The knowledge management system I want is one that will directly help my projects. Simple version of the ultimate aim - I have a todo list (graph). Each item has resources associated with it that are only a click away. The system tells me what to do next to make the best use of my time/resources.

Facets will be managed in the code separately, each with a separate dir under src, but served as an integrated system.

Each facet will have its own Web page (mobile-first) with tabs across the top line of each page linking to the other pages in the system.

Code should be modern, vanilla HTML, CSS and ESM JS. Data will be Turtle/RDF, content managed as Markdown. It should be built in a maximally modular fashion to simplify maintenance and extension. Known best practices should be used throughout. Code files with many lines should be refactored. Node and Vitest should be used as necessary.

Named graphs will be used to distinguish the data of separate facets, there will be maximal crosslinking, it will be an integrated knowledgebase.

## Facets

* GnamGnam bookmark manager/retriever - as current (dim) codebase, bookmark-specific parts moved into src/gnamgnam, common SPARQL & semantic search pieces shifted to src/common
* Trestle Outliner - derived from ~/github/trestle
* Newsmonitor - RSS reader, a port of ~/github/NewsMonitor
* Farelo - KanBan board combined with https://web.archive.org/web/20230321045154/https://hyperdata.it/blog/2015/05/11/getting-things-diced/ 
* Wiki - derived from ~/github/foowiki
* Blog engine
* Squirt - mobile view of *everything*, derived from ~/github/squirt


## Starter (mostly done)

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


