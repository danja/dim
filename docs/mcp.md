# MCP: DIM for agents

`POST /mcp` on the app (default `http://localhost:4110/mcp`) is an
[MCP](https://modelcontextprotocol.io) server over Streamable HTTP, so an agent
can do in DIM whatever the owner can do in the browser. Code: `src/mcp/`.

## Connect

Needs `DIM_WRITE_TOKEN` (the same token as the web login), sent as a Bearer token:

```sh
claude mcp add --transport http dim http://localhost:4110/mcp \
  --header "Authorization: Bearer $DIM_WRITE_TOKEN"
```

```sh
claude mcp add --transport http --scope user dim http://localhost:4110/mcp \
  --header "Authorization: Bearer $DIM_WRITE_TOKEN"
```

Any MCP client that speaks HTTP works the same way. Behind a proxy use the
`DIM_ORIGIN` address.

## Tools

| Tool | What |
|---|---|
| `dim_endpoints` | Lists read paths and write endpoints, with body fields (`method`, `filter` narrow it). Start here. |
| `dim_search` | `q`, optional `facet`, `limit`: one ranked list across bookmarks, wiki, tasks, outlines, news, blog. |
| `dim_get` | `path`: any page or data endpoint. `.json` / `.md` forms come back as such; other pages as text, links as `label (path)`. |
| `dim_write` | `path`, `body`: the POST endpoint behind any form (new task, edit a page, annotate a bookmark, capture, link, subscribe, publish, delete…). |

There is no separate agent API. Each tool makes the request a browser would,
to the same server over loopback, carrying the agent's token, so validation
(SHACL), the change log, link syncing and `DIM_PRIVATE` behave exactly as for a
person. A new route needs no MCP work for reading, and a new *write* route must
be added to `src/mcp/catalog.js`: `tests/mcp` fails until it is.

## Limits

- Stateless: one JSON-RPC message per POST, JSON replies; no sessions, SSE or
  batches. `GET /mcp` answers 405. Only tools are offered (no resources or prompts).
- Refused: a session cookie (Bearer or Basic only), a browser `Origin` that isn't
  DIM's own, and `/login`, `/logout` and `/mcp` itself as paths.
- Answers are cut at 60,000 characters.
- Writes are real and acted as `owner`; the change log can't tell an agent from
  the person. Hand the token only to agents you'd let edit everything.
