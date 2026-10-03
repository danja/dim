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
