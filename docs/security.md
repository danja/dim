# Security

DIM is personal: bookmarks with notes, tasks, a wiki, reading habits, blog
drafts. It was built for localhost. This review (Phase 12, 2026-09-26)
covers what changes when it's reachable from elsewhere, what was fixed,
and what remains.

## Model

- **One owner.** `DIM_WRITE_TOKEN` (16+ characters) is the credential,
  sent as a Bearer token or Basic password, or exchanged at `/login` for a
  session cookie. Cookies are `HttpOnly`, `SameSite=Lax` (sent when you
  open DIM from another app or site, never on another site's requests or
  form posts), and `Secure` when `DIM_ORIGIN` is https. Sessions last 30
  days and survive restarts: `data/sessions.json` (mode 600) holds hashes of
  the session ids, not the ids, and is ignored once `DIM_WRITE_TOKEN`
  changes, so changing the token logs every device out. It isn't backed up.
- **Writes** always need the owner. A session must also send the form's
  CSRF token (`_csrf` or `X-CSRF-Token`); the cookie alone never authorises
  a write. Bearer/Basic callers need no CSRF token: a browser can't send
  those headers cross-site without knowing the token.
- **Reads** are open by default (localhost), or owner-only with
  `DIM_PRIVATE=1`. With it, only these are public: `/login`, `/logout`,
  `/health` (status only), `/static/*`, `/ns/*`, and the app manifest,
  service worker and offline page (browsers fetch those without cookies).
- **MCP** (`POST /mcp`, docs/mcp.md) gives an agent the owner's reach, so it
  needs the token as Bearer/Basic every time, even when reads are open. A
  session cookie is refused and so is a browser `Origin` that isn't DIM's own,
  so a web page can't drive it. It calls DIM's own routes over loopback with
  the caller's credentials: no separate permissions to get wrong.
- **Drafts** (blog) are owner-only even with open reads. So are the Squirt
  timeline and capture.

## Network

- **Loopback only:** Fuseki, Ollama and the app publish on `127.0.0.1`
  only (`docker-compose.yml`). Fuseki's update endpoint must never be
  reachable from outside: it would give full write access to the store.
  DIM never passes user-supplied SPARQL through to the store; every query
  is a named template filled with escaped terms (`SPARQLHelper`,
  `QueryService`).
- **Reaching it from elsewhere:** through an https proxy to the app only
  (docs/deployment.md), with `DIM_PRIVATE=1` and `DIM_ORIGIN` set.

## Pages

- **Headers:** a Content-Security-Policy on every page, with scripts,
  styles and fonts from DIM only, no inline script,
  `frame-ancestors 'none'`, `form-action 'self'` and `base-uri 'none'`.
  Also `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin`. Every page was checked in a browser with
  the policy on: no violations.
- **Markdown:** notes, wiki, blog and Inbox content is sanitised. Raw HTML
  is shown as text, and links are limited to http(s), mailto, local and
  relative paths. Feed text is reduced to plain text and escaped.
- **Redirects:** after a form, redirects go to local paths only (`safeReturn`).
- **Caching:** nothing is cacheable by shared caches (`private, no-cache`),
  since most responses are personal. The browser's own offline copies (the
  service worker) are cleared on log out.

## Findings and fixes (this review)

| Finding | Fix |
|---|---|
| All reads open to anyone who can reach DIM | `DIM_PRIVATE=1` gate; deployment docs make it part of exposing DIM |
| JSON sent `Cache-Control: public` — a caching proxy could serve personal data (drafts, activity) to others | `private, no-cache` everywhere |
| No framing protection on pages with write forms | CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| No CSP | strict CSP, verified against every page |
| Session cookie never `Secure` | `Secure` when `DIM_ORIGIN` is https |
| Squirt's "Saved: …" link took any path starting with `/` from the query string, so `//evil.example` got through | only local paths (`safeReturn`) |
| `/health` detail (counts, whether writes are on) public | status only, for strangers, in private mode |

## Accepted risks

- **Server-side fetching:** subscribing to a feed, polling, and enrichment
  fetch URLs chosen by the owner. That includes addresses inside the
  network, such as `http://fuseki:3030`. They are GETs, capped in size and
  time, and only the owner can add them. Don't import feed lists you don't
  trust.
- **Brute force on `/login`** is slowed (750 ms per failure) but not
  locked out. A 16+ character random token makes guessing impractical;
  use `openssl rand -base64 24`.
- **Sessions are in memory:** a restart logs you out, and there is no
  list of active sessions to revoke. Changing the token and restarting
  ends them all.
- **Third-party text:** feed items are stored in `graph:source/news`
  (`proprietary-linkout`). They are never in the CC0 dump or the blog
  export.
- **LLM calls:** they send page text (enrichment) or task titles and
  reasons (advisor, only when asked) to the configured provider.
