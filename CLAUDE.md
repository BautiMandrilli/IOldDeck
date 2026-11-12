# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Panel Propio turns an iPad 2 (Safari, iOS 9) into a Stream Deck–style LAN control panel for a Windows PC. A Python stdlib HTTP server (`server.py`, port 8765) serves a touch panel to the iPad and a visual editor to the PC (`http://localhost:8765/editor`). `HANDOVER.MD` is the detailed design/decision log — read it before non-trivial work. The user prefers Spanish; UI strings and docs are in Spanish.

## Commands

```powershell
npm ci                      # dev tooling only (nodemon pinned at 3.1.11 for audit reasons — don't bump blindly)
npm run dev                 # nodemon + PANEL_DEV=1 (auto-reload script injected into pages)
npm start                   # = python server.py, no watcher; production needs no Node
npm test                    # Python unittest (tests/) + node tests/test_layout.js
npm run test:dev            # nodemon restart/reload integration test in a temp copy
node tests/browser_smoke.mjs  # headless Chrome via CDP, mocked Spotify; Node 22+, env CHROME / PYTHON; screenshots to .cache/
npm run setup:spotify       # installs requirements-spotify.txt (PyWinRT) + adds Spotify card; server must be stopped
```

Single test: `python -m unittest discover -s tests -p test_server.py -k <test_name> -v` (or `test_spotify.py`).

Before starting a server, check whether port 8765 is already in use (often `npm run dev` is already running). Never run two servers or kill unrelated processes to free the port.

## Architecture

- **`server.py`** — everything backend: pairing/auth, config validation + normalization (`validate()`), atomic config writes, asset upload (SVG sanitized), ZIP backup/restore with rollback, hotkey/URL actions, Spotify endpoints. `RLock` guards data; a separate lock guards actions/button states. Paths derive from `ROOT/data`.
- **`public/layout.js`** — shared by panel and editor (exposes global `PanelLayout`): grid/free layout math, built-in SVG icons, button and Spotify card DOM construction. Also loaded in Node via `vm` by `tests/test_layout.js`.
- **`public/motion.js`** — ES5 global `Motion`, shared by panel and editor: interruptible spring (damping ratio + response), velocity tracker, momentum projection, rubber-band, touch-down press feedback (`pressable`), FLIP reorder (`measure`/`glide`). Page swipe on the iPad and tile settling in the editor use it.
- **`public/style.css`** — shared canvas/tiles/Spotify + iPad chrome (no CSS variables, no Grid). **`public/editor.css`** — editor only (CSS variables OK).
- **`public/app-icons.js`** — generated app-logo library (`window.PanelAppIcons`, Simple Icons CC0). Regenerate/extend via `scripts/build-app-icons.mjs` (edit its `APPS` list; it needs an extracted `simple-icons` package path). Buttons reference a logo as `builtinIcon: "app:<slug>"`; `server.py` accepts that pattern and `PanelLayout.symbol()` renders it as an iOS-style icon.
- New files in `public/` must be added to the static-file whitelist in `Handler.do_GET` (`server.py`), or they 404.
- **`public/app.js` + `index.html`** — iPad panel. **`public/designer.js` + `editor.html`** — PC editor (pending changes, drag/resize, backups). **`public/spotify.js`** — polling, partial DOM updates, authenticated artwork via XHR blob. **`public/dev-reload.js`** — only injected when `PANEL_DEV=1`.
- **Desktop apps** — button action `"app"` with `value` = a slug from `DESKTOP_APPS` in `server.py` (fixed allowlist; never accept arbitrary URI schemes). `open_app()` launches the registered link (`discord://`, `steam://`…) via `os.startfile` when the scheme is in the registry, else opens the web fallback; `bring_app_forward()` then restores/raises the app window from a background thread. Tests must stub `launch_uri` and `bring_app_forward` so they never open or move real windows.
- **`spotify_bridge.py`** — Windows.Media.Control via PyWinRT on its own daemon thread with its own asyncio loop (MTA). Lazily started; publishes a locked snapshot polled every 2s. Never move WinRT objects onto HTTP request threads; keep waits bounded. Missing deps/WinRT failure must not break normal buttons.

### Config model

`data/config.json`, `version: 3` (`validate()` still accepts 1–3, always saves as 3). Pages have `layout: "grid" | "free"`. The page list is named `buttons` but holds types `button`, `folder`, `spotify`. IDs are globally unique; `folderId` refers to a folder on the same page (one level only — no nested folders). Free geometry (`x,y,w,h`) and grid size (`cols,rows`) are stored separately; switching layout modes must not overwrite the other. Grid: 6 columns, 24px margin, 16px gap, 1024px canvas. Limits: 12 pages, 80 items/page, 200 images ≤2.5 MB.

If the config format changes, update together: `validate()`, editor, `layout.js` rendering, backup/restore and its preview summary.

### Auth

Six-digit pairing code printed at startup (regenerated each restart) → persistent token in `data/token.txt`, stored on iPad as `localStorage.panel_token`, sent as `X-Panel-Token`. `/api/local-token` and editing/upload/backup/restore are loopback-only. Backups exclude tokens.

## Constraints

- **Frontend served to the iPad must be ES5**: `XMLHttpRequest` only, no `fetch`, modules, arrow functions, `let`/`const`, `async`/`await`, optional chaining. No CSS Grid; use prefixed Flexbox. Node test files may use modern JS.
- Update existing DOM nodes for state/music changes — don't rebuild the page.
- Spotify card is a `div` with separate `button` controls; never nest buttons. Never put the token in an image URL.
- `data/` is personal and gitignored — never commit it, reset it, or touch it from tests. Tests copy `server.py` into a temp dir before importing it.
- Avoid real Spotify control in tests; if needed, restore the original playback state.
- Report clearly what was verified mocked vs. on real Windows vs. on the physical iPad (no physical iPad test has been done yet).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), written in English:

- Subject: `<type>: <summary>` — imperative, lowercase after the colon, no trailing period, ~72 chars max. Optional scope, e.g. `feat(editor): …`, `fix(spotify): …`.
- Types: `feat` (user-visible feature), `fix` (bug fix), `style`/`refactor` (no behavior change), `test`, `docs`, `chore` (tooling, deps, generated files).
- Always include a body after a blank line: what changed and why, grouped by area (iPad panel, Editor, Server, Tests) as `-` bullet lists. Note anything not yet verified (e.g. "Not yet verified on a physical iPad 2").
- End with the co-author trailer when Claude helped, e.g. `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Run `npm test` (and `node tests/browser_smoke.mjs` for UI changes) before committing; run `git diff --cached --check`.
- Commit only when the user asks. Work on a feature branch (e.g. `feat/<topic>`), not directly on `main`; never push without being asked.
