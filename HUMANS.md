# HUMANS.md

Things Claude can't or shouldn't do for you. Claude: add a section here when a
task needs a manual step from Danny, and say so in the reply.

## Install axe-core (accessibility checks)

axe-core and Playwright aren't installed in this repo, so the axe part of the
UI check in CLAUDE.md ("Playwright with Chromium, a 375px viewport, and axe")
can't run yet. One-off setup, from the repo root:

```sh
npm install --save-dev axe-core playwright
npx playwright install chromium
```

The second command is needed because the Chromium builds already in
`~/.cache/ms-playwright` don't match the Playwright version npm will install.

Then tell Claude it's done. The open item in `TODO.md` ("Run axe on /squirt/
…") will run axe in light and dark at 375px, injecting it with
`bypassCSP: true` because the CSP blocks inline scripts.

Commit `package.json` and `package-lock.json` afterwards. They're dev
dependencies, so the app and `npm test` don't change.

## Install the boot service (systemd)

`deploy/dim.service` starts DIM when the computer boots. It needs root, so run
it yourself (from the repo root, after checking the paths in the file):

```sh
sudo cp deploy/dim.service /etc/systemd/system/dim.service
sudo systemctl daemon-reload
sudo systemctl enable --now dim
systemctl status dim
```

Stop anything already on :4110 first (a `node bin/serve.js` in a terminal, or
the `dim-app` container).

## Check and judge (Claude can't do these)

Open items from `TODO.md` that need your eyes, your data or your decision:

1. **Restart the server** so the new Wiki landing page shows (`/wiki/`), then
   look at it at 375px in light and dark. Tell Claude if the cards or the
   folded "All pages" list look wrong; the axe run waits on the install above.
2. **Try the Graph RAG options on live data.** Run `node bin/communities.js`,
   then `node bin/ask.js --similar --communities "…"` on a few real questions,
   and settle the defaults in `RAG_CONFIG` (`config/preferences.js`).
3. **Judge `bin/ask.js` on 10–20 real questions** and note which settings
   (`hops`, `fanout`, link weights) give better sources; tell Claude what to
   tune.
4. **Try `node bin/communities.js --similar`** (slow the first time: one
   embedding per item in the links graph; it needs Ollama) and compare
   `--list` with and without it. Keep it only if the clusters read better.
5. **Decide the design of "notes become Todo items and vice versa".** The
   Farelo "make a wiki page or outline item" button already goes task → note.
   What's missing is note → task: from a wiki page, an outline node, or both?
   And "vice versa" as a second link, or converting (moving) the item?
6. **Commit** the work so far (Claude doesn't commit unless asked).
