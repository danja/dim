# Blog — Commands and use

Write posts in DIM, or start them from a wiki page or an outline item.
Publish them at dated URLs with an Atom feed, and export the published posts
as a static site to host anywhere (DIM itself stays on localhost). Posts
live in `graph:facet/blog`. Background: `docs/plan-detail.md` (Phase 9).

## Writing

Log in first (`DIM_WRITE_TOKEN`; see `docs/commands-gnamgnam.md`).

- **New post:** `/blog/` → type a title → **New draft** → the editor.
- **From a wiki page:** the page's **Draft a blog post** button copies its
  title, text and tags into a new draft.
- **From an outline item** (Trestle): its **Draft a blog post** button uses
  the item's title, with its note and everything under it as a Markdown
  list.

A draft remembers what it started from (`prov:wasDerivedFrom`, plus a
`related` link). Later edits to the source don't change the post.

In the editor you can set the title, the text (Markdown), a summary (used
in lists and the feed; otherwise the first paragraph) and tags.
**Preview** saves nothing.

- **Links:** `[[Post title]]` links to that post. `[[Other title]]` goes to
  the wiki page of that name inside DIM, but becomes plain text on the
  public site and in the feed.
- **Publish:** gives the post its date and URL, `/blog/YYYY/MM/DD/slug`.
  **Unpublish** returns it to draft. Publishing again keeps the original
  date, so the URL never moves.

## Who sees what

| | logged in | anyone else |
|---|---|---|
| published posts, tag pages, `/blog/feed.atom`, `/find` | ✓ | ✓ |
| drafts (`/blog/post/<slug>`, drafts list, editor) | ✓ | 404 |
| static export | published only | |

## URLs

| URL | |
|---|---|
| `/blog/` | posts, newest first (with drafts, when logged in) |
| `/blog/YYYY/MM/DD/<slug>` | a published post |
| `/blog/post/<slug>` | any post: redirects to the dated URL once published (`.md`, `.json`) |
| `/blog/post/<slug>/edit` | editor |
| `/blog/tag/<tag>` | posts with a tag |
| `/blog/feed.atom` | Atom feed of the latest 20 published posts |

From a script: `POST /blog/posts` `{title, content, tags}` or `{from: <IRI,
page path or [[Title]]>}`; `POST /blog/post/<slug>` `{title, content,
tags, abstract}`; `POST /blog/post/<slug>/publish` `{publish: true|false}`;
`POST /blog/post/<slug>/delete`.

## Static export

```sh
node bin/blog-export.js --out data/blog-site --base-url https://example.org/blog/ --title "My blog" --author "Me"
python3 -m http.server -d data/blog-site 8000     # preview at http://localhost:8000/
```

- **Output:** `index.html`, `YYYY/MM/DD/slug/index.html`,
  `tag/<tag>/index.html`, `feed.atom` and `style.css`. Upload the directory
  to any static host at `--base-url`.
- **Links:** all relative, so the site works under any path. Links to other
  posts are kept; links into the rest of DIM (bookmarks, wiki pages, tasks)
  become plain text.
- **Replacing:** the output directory is replaced on each run, but only if
  it is empty or was made by this tool (it leaves a `.dim-blog-export`
  marker).
- **Defaults:** `--base-url`, `--title` and `--author` default to
  `BLOG_BASE_URL`, `BLOG_TITLE` and `BLOG_AUTHOR` (see `.env.example`).
