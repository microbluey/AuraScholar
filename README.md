# AuraScholar

> An open-source research assistant for early-career researchers — discover, manage, read, connect, and cite, in one seamless workflow.

[![CI](https://github.com/microbluey/AuraScholar/actions/workflows/ci.yml/badge.svg)](https://github.com/microbluey/AuraScholar/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

**English** | [简体中文](./README.zh-CN.md)

AuraScholar helps master's/PhD students, postdocs, and early-career faculty run their daily research as one smooth pipeline: from discovering papers, to managing and reading them, to reorganizing evidence and ideas on a spatial canvas, and to inserting citations while writing.

![Library workspace](./assets/screenshots/library.png)

> The interface is currently Chinese-first.

> [!NOTE]
> **Project status: early development (alpha).** The core workflow works but is under active iteration — expect rough edges and breaking changes. Not recommended for managing your primary research library yet.

## Features

### 📚 Library workbench

- **Ingest from anywhere**: add papers by DOI / arXiv ID / URL / local PDF in one step; metadata is fetched automatically and open-access (OA) full text is downloaded when available. Local PDFs are matched back to their DOI from the body text.
- **Bulk migration**: import BibTeX / RIS / CSL-JSON from Zotero / EndNote, with automatic deduplication by DOI and a title+year+authors fingerprint.
- **Rollback-safe work state and recycle bin**: starred/read status updates plus single or bulk trash/restore operations cross a typed main-process command boundary; every batch is one Library-scoped transaction and cannot partially apply. Permanent deletion uses the same ownership guard, so failed dependent-record cleanup cannot leave a paper half-erased. Bounded, main-process cleanup reclaims PDF blobs left by incomplete staged imports only after checking every attachment and document-revision reference; it never sweeps arbitrary historic blobs.
- **Relationship-safe duplicate merging**: merging duplicate records runs as one Library-scoped main-process transaction. It unions valid folder and tag memberships, retargets PDFs, annotations, citations, Canvas references, derived data, and background tasks, and rolls every change back if any step fails.
- **Metadata sources**: aggregates five open data sources — Crossref, OpenAlex, Semantic Scholar, Unpaywall, and arXiv.

### 🗂️ Research projects

- **Bounded project workspaces**: create, switch, and rename independent research projects at RESTful `/projects/:projectId` routes. Opening `/projects` resumes the most recently used active project, while first use creates a safe default scope.
- **Project sources without duplication**: search the Library from a project and add multiple papers as project sources. Library single-paper and bulk actions use the same lightweight target picker; with one project, papers are added directly, while multiple projects default to the most recently active target and support creating one in place.
- **Library-safe membership**: removing a source only removes its project membership. The canonical Library work, metadata, annotations, PDF attachments, and source files remain untouched.

### 🔍 Academic search

- **Federated open-source search**: native aggregation across OpenAlex / Crossref / Semantic Scholar / arXiv with merged, deduplicated results, in-library markers, and one-click ingest (including OA PDF retrieval).
- **Saved-search subscriptions**: saved open-source queries catch up at desktop-app startup; while the desktop window is open, an hourly scheduler checks due subscriptions. They do not poll in the background after the app is closed.
- **Reliable full-text completion loop**: “Find full text” from Library, Reader, or a search result validates candidates in Unpaywall → arXiv → explicit OA-PDF order before falling back to the research browser. Each task carries a unique ID, target work, and origin; Reader/Library handoffs add a validated return route, while browser fallback binds the actual root tab and its child-tab chain. Late downloads therefore cannot attach to a newer target, and completion refreshes the full-text state before returning when a safe route exists.
- **Built-in research browser**: open Google Scholar, Web of Science, Scopus, PubMed, CNKI, IEEE Xplore, ScienceDirect, SpringerLink, Wiley, ACM, JSTOR, ResearchGate, bioRxiv, DBLP, Baidu Scholar, Wanfang, VIP and more in in-app tabs (sites are customizable). Each site gets an isolated, persistent login session.
  - **Captured downloads with confirmation**: PDFs downloaded on site (including via institutional subscriptions) are captured and analyzed. New files and cross-work DOI/content-hash conflicts wait for destination confirmation; an exact duplicate already belonging to the explicit target can attach idempotently. Exported citation files are still recognized and deduplicated automatically.
  - **Arc-style tab archiving**: inactive tabs hibernate to free memory and restore instantly on click.
  - **Flexible networking**: per-site proxy settings (campus VPN and personal proxies coexist), plus library EZproxy prefixes to open paywalled articles with your institution's subscription.

![Academic search](./assets/screenshots/discovery.png)

### 📖 PDF reader

- Highlights, underlines, strikethroughs, sticky notes/comments, with multi-level text anchoring.
- Selection / page / full-document translation (LLM / DeepL / Baidu), with cached results to avoid repeat token costs.
- Reader selections can be saved as revision-bound PDF text Evidence and reopened against the captured source revision.
- Panel views: annotations · translation · citation context (for DOI-linked works).
- **Citation context graph**: presents citation relationships on a timeline instead of a hard-to-read citation tree.

### 🧠 Spatial canvas & AI synthesis

- **Multiple independent canvases**: separate research projects into their own workspaces. The canvas header switcher creates and switches canvases, while each workspace's `...` menu supports rename and safe deletion. Deletion requires confirmation, reports the card count, and always preserves at least one canvas; Library papers and PDF sources are never removed. Opening `/canvas` resumes the most recently used workspace at its RESTful `/canvas/:workspaceId` route, and existing default-canvas data is preserved as the first workspace.
- **Infinite research canvas**: place whole papers, PDF excerpts, researcher ideas, and AI synthesis results on one pannable, zoomable dot-grid canvas, with box selection, multi-select, direct links, and collapsible groups.
- **Five built-in node types**: add a paper from the library or reader before making any excerpt; arrange paper, excerpt, AI synthesis, Markdown/LaTeX idea-note, and logical group nodes.
- **Layered canvas controls**: the bottom Dock now keeps only Library, a unified create menu, and the pointer tool. Zoom, fit-to-view, and the on-demand MiniMap live in a compact bottom-right navigation island. Group, tidy, AI synthesis, and bulk removal appear above the selection only when multiple cards make those actions relevant.
- **Direct card interactions**: a regular click opens a paper or excerpt in the split reader; AI synthesis and groups still use the left Details panel. Idea notes are edited where they live: click the title or Markdown body to edit it directly on the card, or expand into a focused editor with source, split, and preview modes, GFM/LaTeX rendering, formatting shortcuts, and `Cmd` / `Ctrl` + `S` save. A click selects a link; a real pointer double-click edits its optional free-text label inline, with `F2` as the keyboard equivalent. Right-click, a trackpad two-finger click, or the card `...` button opens contextual actions; `Shift` / `Cmd` / `Ctrl`-click remains dedicated to multi-selection.
- **Crash-safe local note drafts**: the focused Markdown editor automatically keeps workspace- and node-scoped, per-window revisions on the current device, so an unsaved idea note can be recovered after a reload or unexpected exit without two tabs overwriting each other. Closing the editor or taking an app-managed route away with changes offers **Save and close**, **Discard**, and **Continue editing**; restore and save paths revalidate the workspace, node, and base content version so a newer note is never silently overwritten. These recovery drafts are intentionally device-local and are not synchronized through WebDAV.
- **Guarded keyboard deletion**: when the canvas itself has focus, `Delete` / `Backspace` removes the selected canvas node or link. The shortcut is disabled while typing, using a modal/menu, or working in the reader. Removing a group keeps its child cards, and removing any canvas card never deletes its Library paper or PDF source.
- **Workspace-scoped undo and redo**: use `Cmd` / `Ctrl` + `Z` to undo and `Cmd` + `Shift` + `Z` or `Ctrl` + `Y` / `Ctrl` + `Shift` + `Z` to redo canvas edits. Each workspace keeps its own 50-step session history across canvas switches; card dragging and rapid field edits are coalesced, viewport navigation and group visibility are excluded, and native text-editor history is never intercepted. The same actions are discoverable from the pointer menu.
- **Canvas command palette**: press `Cmd` / `Ctrl` + `K` to search the full Library by title, author, venue, year, or tag and create a `PaperNode` at the most recent canvas pointer position. Choosing a paper already on the canvas focuses it and expands its collapsed group instead of duplicating it. Typing `/ai` exposes only the four existing, source-bounded synthesis actions—not an open-ended chat prompt.
- **Mixed-card tidy and paper layouts**: select at least two same-level cards, then use the contextual selection bar, the multi-select context menu, or `Cmd` / `Ctrl` + `Shift` + `L` to pack papers, excerpts, notes, AI syntheses, and group containers into a deterministic, non-overlapping grid that respects their real sizes and current reading order. A selected group moves as one card, so selected descendants are not moved twice. All-paper selections additionally offer publication-year and citation-tree layouts. Citation-tree layout resolves relationships from the local Library first and, when needed on Desktop, reuses the cached Citation Context Graph or loads the selected DOI neighborhood from OpenAlex. These relationships are transient layout input—manual links are never reclassified and no hidden canvas links are created. Circularly citing papers stay in the same column, while selection/workspace fingerprints and request cancellation prevent a late graph response from moving the wrong canvas.
- **Canvas + reader split view**: single-click a paper or excerpt to open it in an adjustable reader beside the canvas instead of losing the canvas context. The default desktop layout keeps roughly 60% for the canvas and 40% for the reader; excerpts open their anchored attachment, annotation, and page, with the full reader still available as a fallback.
- **Highlight-to-canvas workflow**: save a PDF highlight, then drag its excerpt chip onto the canvas or use **Add to current canvas**. AuraScholar atomically verifies the authoritative annotation, attachment, paper, and workspace identities before it creates or reuses the `PaperNode`, creates the `ExcerptNode`, and establishes its source link. Repeating the handoff focuses the existing excerpt and repairs a missing source card or link instead of duplicating content; a stale or conflicting request commits nothing.
- **Direct magnetic links and linked notes**: hover or focus a card to reveal magnetic handles on its four sides. Drag to another card to connect immediately—there is no relationship-type picker. Drop on empty canvas to atomically create a blank `IdeaNoteNode` at that point and connect it to the source. Links start without text; double-click one to add or clear an arbitrary label. `Escape` and workspace identity checks cancel stale gestures safely. Each source → target direction is deduplicated, while the reverse link remains valid.
- **Source-bounded AI synthesis**: select 2–10 paper or excerpt nodes to generate a methodology matrix, contradiction analysis, research-gap analysis, or concise synthesis. Paper nodes provide metadata and available abstracts—not full PDF text—while excerpt nodes provide selected source text. Results retain their source nodes and links; before an asynchronous result is committed, AuraScholar revalidates the request, workspace, and every source node's identity, type, and content version so a stale result cannot create orphan source links. Actual generation requires a configured AI provider.
- **Library and reader intake**: adding a paper or excerpt goes directly to the only canvas when one exists; with multiple canvases, a lightweight picker defaults to the active canvas and can create a new target in place.
- **Close-safe local persistence**: the desktop app stores canvas data in SQLite. Every router-managed exit—including canvas switches, global navigation, and Back/Forward—first settles active in-card, link-label, and focused Markdown edits, then waits for every loaded workspace's latest snapshot to persist. IME composition, **Continue editing**, version conflicts, or save failures keep the current canvas open. Window close and app quit additionally use a bounded renderer/main-process save handshake; a failed save keeps the app open unless the user explicitly force-closes. Whole-library JSON backups include canvas data, while Spatial Canvas is not yet included in row-level WebDAV sync. Local PDFs are intentionally unavailable in the browser preview, so the split reader's real PDF workflow must be used in the desktop app. See the [Spatial Canvas product and architecture notes](./docs/SPATIAL_CANVAS_PRD.md) (Chinese).

![Spatial research canvas](./assets/screenshots/canvas.jpg)

### ✍️ Writing support

- **Writing snippets**: capture excerpts while reading, organized per paper, with notes and jump-back-to-source.
- **Citation formatting**: export APA 7th, GB/T 7714-2015, IEEE, Vancouver, MLA 9th, Nature, Chicago and more, plus BibTeX / RIS / CSL-JSON.
- **Word citation bridge** (planned): a built-in local service reserved for a future Word add-in — Zotero-style cite-while-you-write.

### 📡 Indexing sentinel

- Monitors each paper's journey from Accept → Online → Issue → database indexing, notifies you on every state change, and keeps evidence snapshots. Papers without a DOI can be tracked by title and are upgraded to DOI tracking automatically; published papers are ingested into the library on arrival. It catches up at desktop-app startup and polls hourly only while the desktop window is open; it is not a 24/7 background service after the app is closed.

![Indexing sentinel](./assets/screenshots/sentinel.png)

### 🌐 Academic homepage / CV

- Syncs your published work, lets you edit your profile and select papers to feature, with live preview and exportable homepage and CV.

## Design principles

- **Local-first**: your data lives on your device (SQLite) and can be backed up anywhere.
- **WebDAV row sync (current scope)**: synchronize works, research projects and memberships, document asset/revision metadata, Evidence and project membership, annotations, flashcards, and Sentinel task state through your own WebDAV endpoint, including compatible NAS or cloud storage (hybrid logical clocks + per-field LWW conflict resolution).
- **Device-local source files and Canvas**: WebDAV does not transfer source-document blobs, including PDFs; remote revisions require explicit reattachment. It also does not synchronize author, collection, or tag relationships; snippets; saved searches; or Spatial Canvas. Canvas currently moves through whole-library JSON export/import, whose backups also omit PDF bytes. AI runs on your own model service and API key (OpenAI-compatible / Anthropic).
- **Pay for convenience**: official cloud sync, hosted AI, 24/7 cloud sentinel, and homepage hosting are optional paid services for users who prefer zero setup.
- **Two themes**: a calm scholarly "Dawn" light theme and a technical "Nocturne" dark theme.

## Project structure

```
apps/
  desktop/    # Electron desktop app (macOS / Windows / Linux)
  gallery/    # Dual-theme component gallery (design reference)
packages/
  tokens/     # Dual-theme design tokens
  ui/         # Shared React component primitives and styles
  db/         # Drizzle ORM schema and migrations
  platform/   # Platform abstractions (HTTP / FS / notifications / keychain / scheduling)
  connectors/ # Crossref / OpenAlex / Semantic Scholar / Unpaywall / arXiv clients
  anchors/    # Dependency-free, versioned SourceAnchor schema and validation
  core/       # Domain logic: ingest pipeline, federated search, sentinel state machine, spatial canvas types, citation graph
  reader/     # PDF reader and annotation engine (multi-level anchoring)
  translate/  # Translation abstraction and providers (LLM / DeepL / Baidu)
  cite/       # CSL citation formatting, BibTeX/RIS import/export
  ai/         # AIProvider abstraction, BYOK implementations, and canvas synthesis
  sync/       # Sync engine (HLC + per-field LWW) and JSON backup/import remapping
  homepage/   # Homepage templates and CV generation
```

Web and mobile clients are planned only; their app directories do not yet exist in this repository.

The desktop shell is Electron. Shared, platform-agnostic domain logic lives in `packages/`; Electron-specific orchestration and UI live in `apps/desktop/`. The Electron main process provides SQLite / CORS-free HTTP / file system / notifications / the built-in browser, bridged to the renderer through the preload `window.aura` API. See [apps/desktop/README.md](./apps/desktop/README.md) for the architecture.

The first user-facing Research Knowledge Layer workflow is now in place: Reader selections can be saved as revision-bound PDF text Evidence, triaged in a searchable Evidence Inbox, assigned to Research Projects, recoverably removed, and reopened against the exact captured revision. Missing local source bridges can be restored only after byte-size and SHA-256 verification; this never retargets Evidence to a newer revision or deletes Library papers/PDFs. Anchored retrieval, hybrid RAG, universal reading, and manuscript-writing workflows remain staged work in the [Research Knowledge Layer RFC](./docs/KNOWLEDGE_LAYER_RFC.md).

## Development

```bash
pnpm install
pnpm build        # build all packages
pnpm test         # run tests

# Run the desktop app (Electron)
pnpm --filter @aurascholar/desktop rebuild:electron   # first run / after tests: switch native modules to the Electron ABI
pnpm --filter @aurascholar/desktop dev
```

The desktop app is pure JS/TS Electron — no Rust toolchain required. The only native dependency, `better-sqlite3`, needs different binary ABIs under Node (tests) and Electron (app): after `pnpm install` you're on the Node ABI (`pnpm test` just works); run `rebuild:electron` before starting the app, and `pnpm rebuild better-sqlite3` to switch back for tests. Packaging (`pnpm --filter @aurascholar/desktop package`) rebuilds for Electron automatically. See [apps/desktop/README.md](./apps/desktop/README.md) for details.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[AGPL-3.0-only](./LICENSE)
