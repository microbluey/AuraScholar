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
- **Platform layer** — `src/services/aura-platform.ts` adapts the restricted
  `window.aura` preload bridge to HTTP and notifications. Reader PDF bytes are
  served by a work/attachment-scoped typed command and read from the
  main-owned canonical BlobStore; renderer data access never receives a shared
  `Database` handle or a filesystem path.
- **Renderer data boundaries** — new and migrated pages consume typed services
  instead of opening database sessions or embedding SQL. Read services own
  active-Library scoping and row aggregation; durable multi-row mutations go
  through typed `window.aura.data.command` gateways so transaction ownership
  remains in the main process. The architecture-health gate rejects recognized
  direct database-session, Repository-construction, and SQL-access patterns in
  renderer pages and components.
- **Smoke-only raw SQL** — the end-to-end smoke harness has an isolated raw
  SQL bridge solely for fixture setup and inspection. Main grants it only to
  an unpackaged smoke process; packaged builds ignore `AURASCHOLAR_SMOKE` and
  never expose that capability through preload.
- **Renderer feature controllers** — migrated workflows keep async mutations,
  modal lifecycles, and global event subscriptions in feature hooks. Pages
  consume semantic actions and compose those workflows with their view state.
- Domain logic lives in `packages/*` and is shell-agnostic (depends only on the
  `@aurascholar/platform` interfaces).

## Research browser

Each open site is a `WebContentsView` in the main process with a per-site
persistent session partition (`persist:research-<siteId>`) — logins/cookies are
isolated and survive restarts. Bounds are driven from main (the renderer only
reports the content-area rectangle via `research:setBounds`), so the embedded
view always sits flush. Tabs idle past 30 min are archived (view destroyed,
memory reclaimed); clicking an archived tab recreates it at its stored URL.
Downloads inside a tab are intercepted (`will-download`) and held behind a
main-owned, short-lived opaque lease. The renderer consumes each lease once;
the resulting bytes are routed to `ingestFromPdf` / `importReferences` without
exposing an app-data path or filesystem delete capability.

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

### Optional ONNX Runtime packaging

The local-embedding runtime is not yet a desktop dependency. When
`onnxruntime-node` is added, the registered `afterPack` hook removes every
non-target native binary from its staged `napi-v3` directory. It does nothing
while that optional package is absent and fails packaging if the requested
target lacks a matching binary. The `asarUnpack` rule explicitly keeps its
native package outside `app.asar`. The current contract supports macOS,
Windows, and Linux on x64 or arm64; universal macOS packaging needs an explicit
dual-architecture policy before it is enabled.

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
- `smoke:embedding-runtime` — create a disposable Electron package with the
  optional embedding runtime, retain only the native target binary, then launch
  it with remote model loading disabled. It downloads npm runtime packages but
  never downloads a model artifact; use it on a native target runner or before
  changing Electron/ONNX Runtime versions.
- `package` — build + electron-builder (dmg/nsis/AppImage) into `release/`
- `rebuild:electron` — recompile native modules against the Electron ABI
