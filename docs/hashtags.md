# Hashtags

`#synth` in a note, wiki page, task, outline node or blog post is a tag. It
shows as a link to `/tags/synth`, and the page lists everything that uses it,
beside what carries the tag in a tags field (bookmarks, tasks, pages, feeds).

## What counts

- `#` at the start of a word, then a letter, digit or `_`, with at least one
  letter, so `#123` (an issue), `page#top` (an anchor) and `# Heading` are not tags.
- `#music/synth` is a tag under `#music`. Letters, digits, `_` and `-`; lower-cased;
  up to 60 characters; no `--`.
- Code (inline and fenced) is left alone, and so is `[text](#anchor)`.
- Read from: bookmark notes, wiki page text, task title and note, outline node
  title and note, blog post text. Not from imported or fetched text (news, summaries).

## Model (SKOS)

Everything is in `graph:facet/links`, next to the other cross-facet links.

```turtle
dim:hashtags a skos:ConceptScheme ; skos:hasTopConcept dim:concept/tag-music .
dim:concept/tag-music        a skos:Concept ; skos:inScheme dim:hashtags ; skos:prefLabel "music" .
dim:concept/tag-music--synth a skos:Concept ; skos:inScheme dim:hashtags ; skos:prefLabel "music/synth" ;
                             skos:broader dim:concept/tag-music .
dim:page/home dim:hashtag dim:concept/tag-music--synth .   # a sub-property of dcterms:subject
```

`dim:hashtag` is derived on save, like `dim:mentions` (`LinkStore.syncHashtags`):
a save replaces the resource's uses and creates any concept it is missing, with
the tags above it. Concepts stay when no one uses them any more. A tag is
narrower than its parent, so `/tags/music` also lists what is tagged
`#music/synth`; the tag page links the tags above and below.

Code: `src/common/hashtags/` (parse, triples, `HashtagStore` for reading),
`sparql/queries/hashtags/`. `/tags`, `/tags.json` and `/tags/<tag>(.json)` merge
them with the facets' own tags; if the store can't answer for hashtags, only the
facets' tags are shown.

## Not done

- Existing text is only read when it is next saved: there is no backfill tool yet.
- Tags in a tags field and `#tags` of the same name count as two uses of one tag.
- Hashtags don't feed the topics scheme (`bin/topics.js`); `/tags/<tag>` still links
  a tag that is also a topic.
