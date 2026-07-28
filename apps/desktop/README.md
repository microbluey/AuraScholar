# AuraScholar Desktop (Electron)

The desktop shell. React renderer (`src/`) + Electron main/preload (`electron/`),
built with [electron-vite](https://electron-vite.org/).

## Architecture

- **Renderer** (`src/`) — the full React app. Talks to the main process only
  through the whitelisted preload bridge exposed on `window.aura`
  (`electron/preload.ts`). No `nodeIntegration`; `contextIsolation` on.
- **Main** (`electron/main.ts` + `electron/main/*`) — owns the SQLite
  connection (better-sqlite3), CORS-free HTTP, FS under app-data, OS
  notifications, secrets, the multi-tab research browser, and the local
  citation bridge.
- **Platform layer** — `src/services/aura-platform.ts` / `aura-db.ts` adapt
  the `window.aura` preload bridge to the `@aurascholar/platform` interfaces
  (HTTP / FS / notifications) and the shared `Database` handle.
- Domain logic lives in `packages/*` and is shell-agnostic (depends only on the
  `@aurascholar/platform` interfaces).

## Research browser

Each open site is a `WebContentsView` in the main process with a per-site
persistent session partition (`persist:research-<siteId>`) — logins/cookies are
isolated and survive restarts. Bounds are driven from main (the renderer only
reports the content-area rectangle via `research:setBounds`), so the embedded
view always sits flush. Tabs idle past 30 min are archived (view destroyed,
memory reclaimed); clicking an archived tab recreates it at its stored URL.
Downloads inside a tab are intercepted (`will-download`), saved under
`AppData/research-downloads`, and routed to `ingestFromPdf` /
`importReferences`.

### Network: proxy + EZproxy

Two independent knobs, set in "管理站点":

- **Per-site proxy** — a global proxy address (e.g. `http://127.0.0.1:7890`) plus
  a per-site "走代理" toggle. Only ticked sites route through it
  (`session.setProxy({ proxyRules })`); everything else uses the system network,
  so a campus VPN (system-level) and a local proxy (no TUN/system mode) coexist
  without fighting over routes. Scope is the site's whole session, including
  in-session navigations to other domains.
- **EZproxy prefix** — paste the library off-campus prefix (e.g.
  `https://login.ezproxy.lib.school.edu/login?url=` or any string with `{url}`).
  While viewing a subscribed journal, "通过图书馆打开" reloads the current tab's
  URL through the prefix, carrying the school's subscription identity without
  needing the campus IP — the correct fix for the "search needs proxy, full text
  needs campus identity" conflict. Stored in `settings` (`research.proxy`,
  `research.ezproxy`); per-site flag is `discovery_sites.use_proxy` (migration v9).

## Native module ABI — IMPORTANT

`better-sqlite3` is a native addon. Its single compiled binary can target the
**Node** ABI (for `vitest`) **or** the **Electron** ABI (for the app), not both.

- Fresh `pnpm install` leaves it on the **Node** ABI → `pnpm test` passes.
- Before running the app in dev, switch it to the Electron ABI:

  ```sh
  pnpm --filter @aurascholar/desktop rebuild:electron
  pnpm --filter @aurascholar/desktop dev
  ```

- To run the db tests again afterwards, rebuild for Node:

  ```sh
  pnpm rebuild better-sqlite3   # or: node-gyp rebuild in its package dir
  ```

- Packaging (`pnpm --filter @aurascholar/desktop package`) rebuilds for Electron
  automatically (`npmRebuild: true` in the electron-builder config).

If you see `NODE_MODULE_VERSION 130 vs 141`, that's this ABI mismatch — rebuild
for the runtime you're using.

## Scripts

- `dev` — electron-vite dev (HMR renderer + main)
- `build` — build all three bundles into `out/`
- `test` — renderer unit tests plus the smoke-runner stream parser tests
- `typecheck` — renderer (`tsconfig.json`) + main/preload (`tsconfig.node.json`)
- `smoke` — build, switch `better-sqlite3` to the Electron ABI, and run the
  full in-app Electron contract suite in an isolated user-data directory. The
  harness reports its current feature stage while running and defaults to a
  five-minute renderer timeout; set `AURASCHOLAR_SMOKE_TIMEOUT_MS` to override
  it when diagnosing a slower machine.
- `package` — build + electron-builder (dmg/nsis/AppImage) into `release/`
- `rebuild:electron` — recompile native modules against the Electron ABI
