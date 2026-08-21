# Build list

## P0 — Architecture + Source Contract

- [x] Canonical archive, Portal, Reader, and future Mirror layer boundaries documented.
- [x] Exact pinned source and provenance contract documented.
- [x] Validating local importer generates a derived snapshot and `LORE_SOURCE.json`.
- [x] Canonical record, chronology, evidence, and media schema boundaries defined.
- [x] Source-contract tests and minimal static build established.
- [x] Exact Git-object import proven against canonical commit `464933cecb6f508a980a66d37c8a7ef7add2f53d`: 130 records, 130 unique IDs, and derived provenance/snapshot output.

## P1 — Book Reader

- [x] Pond Archive cover — implemented with verified generated-snapshot state and an honest unavailable state.
- [x] Living night atmosphere and verified Enter Archive navigation.
- [x] Ripple Chronicle.
- [x] Chapter reader.
- [x] Evidence Lens.
- [x] Original / Commentary / Both and deterministic previous / next navigation.
- [ ] Persistent reading progress / Continue Reading persistence.
- [x] Lore Bookmark and Share Affordances (Stage 2A-P2U1): persistent browser-local `localStorage` bookmarks keyed only by `canonicalId` — an ordered collection of IDs, storing no duplicated title, content, source URL, provenance, media interpretation, or canonical lore bytes. A `/bookmarks/` Reader view resolves saved IDs against the current verified archive state; missing or removed canonical IDs fail gracefully rather than crash or show stale copied content. Corrupt, unavailable, or disabled browser storage never breaks ordinary Reader use (safe degradation). Share v1 is individual lore deep links `/record/<canonicalId>` only, preferring the native Web Share API with Copy Link fallback. No bookmark-set export/import, account, wallet, backend, cloud sync, telemetry, analytics, social SDK, canonical-data mutation, or provenance mutation. Bookmark state is personal Reader-runtime state, deliberately outside canonical/provenance governance.
- [ ] Appearance / font controls.

## P2 — Artifacts + Music

- [x] Historical artifact contract defined (Stage 2A-P1): authored identity, governed digest, source vs archive locator, type vs role, rights, original vs derivative, derived admission state. No importer, manifest, rendering, or fetching yet.
- [x] Legacy media candidate manifest generated (Stage 2A-P2): importer emits a provenance-bound `generated/legacy-media-candidates.json` from legacy `img`; deterministic `legacy-img:<id>` candidate keys (NOT artifactIds); REFERENCE_ONLY state; fail-closed validation. No rendering, fetching, or PWA yet.
- [x] Canonical source-advancement binding repair (Stage 2A-P2R): the importer no longer hard-pins one canonical commit. Repository/path are permanent architecture constants; the commit is an explicit, reviewed, advanceable full SHA. Source bytes are mechanically bound to the exact Git object `<commit>:lore/data.json` via read-only Git plumbing (no caller-supplied bytes, no working-tree authority, no network). Mutability/advancement + byte-binding + fail-closed proofs added. The current generation commit `464933cecb6f508a980a66d37c8a7ef7add2f53d` remains the current imported generation, not a permanent import law.
- [x] Public automatic canonical publishing (Stage 2A-PUB1): a Reader-owned five-minute poll, manual dispatch, and Reader-`main` push workflow checks out the one canonical `ToadAid/toadaid.github.io/lore/data.json` source, reuses the P2R2 `sync:canonical` engine, and deploys the static Reader to the GitHub Pages project site only after successful sync, validation, Pages-base build, and artifact crawl. Invalid canonical source and build failures fail closed before deployment, so the prior Pages deployment remains live. The browser never fetches canonical lore at runtime; `/toadaid-lore-reader/` routing, Share deep links, and public art are project-base-safe while default/local routing remains `/`. Desktop explicit Sync Lore remains a separate operator surface. Generated generations remain uncommitted derived material. This does not mark PWA/offline complete.
- [x] Media interpretation manifest (Stage 2A-P2M1): deterministic legacy-media classification from canonical strings — kinds IMAGE/VIDEO/AUDIO/YOUTUBE/UNKNOWN_REFERENCE derived only from trustworthy URL extensions and mechanically recognized YouTube forms; never guesses, never infers preservation. Importer emits a provenance-bound `generated/media-interpretation.json`; a sealed validator re-derives the exact manifest from the snapshot and requires strict equality (fail-closed). Classification only: no artifactId, no digest, no archive locator, no rights, no admission state. Historical media candidate manifest (P2) remains unchanged and separate.
- [x] Media-aware Reader rendering (Stage 2A-P2M2): individual `/record/<canonicalId>` pages render the already-classified interpretation as a "Historical Media" section, trusting the generated manifest's `kind` (no re-classification). Inline media is HTTPS-only (`<img>`/`<video>`/`<audio>` with runtime fallback to an external reference link); HTTP references render link-only; unsafe schemes (`javascript:`, `data:`, `file:`) render as non-clickable escaped text. YouTube is click-to-load via `https://www.youtube-nocookie.com/embed/<validated-id>` with no iframe network request before user activation. A displayed remote asset is a historical external media reference, never a preserved artifact. Fail-closed when a generated snapshot is present but the interpretation is missing/invalid/wrong-generation/not the exact derivation; clean checkout (no generated archive) builds unchanged.
- [ ] Historical artifact preservation and admission not otherwise started: no governed admission of legacy `img`/media into HistoricalArtifact objects, no fetching, no byte-identity verification, no archive locators minted. P2M1/P2M2 deliberately render historical external media references only; preservation remains the separate governed contract from Stage 2A-P1.

## P3 — PWA / Offline

- [x] Verified Offline PWA Archive (Stage 2A-PWA1): public builds explicitly admitted with `PUBLIC_PWA=1` emit a base-aware manifest and bounded service worker. The service worker precaches only the complete same-origin generated Reader, keyed by exact Reader SHA + canonical SHA; it never fetches canonical source or third-party media. Existing Pond Archive artwork supplies documented deterministic 192px and 512px installation icon derivatives. Default/local and desktop builds do not register PWA behavior.

## Desktop Distribution

- [x] Packaged read-only Linux x64 runtime (Stage 2A-DESK2-P1): `npm run desktop:package:linux` stages only the built non-PWA Reader plus the minimal Electron host/navigation/single-instance modules, then produces a disposable portable application under `release/`. This end-user mode has no sync overlay, repository chooser, preload, IPC, canonical Git/source, or Node/npm/source-checkout dependency.
- [x] Windows x64 portable packaged Reader (Stage 2A-DESK2-P2): the same shared staging/runtime path can cross-package an unsigned `win32/x64` portable directory with `npm run desktop:package:windows`. Windows live dogfood remains pending; code signing is not performed and SmartScreen trust is not claimed.
- [x] macOS x64 and arm64 portable packaged Reader (Stage 2A-DESK2-P3): the same shared staging/runtime path structurally packages separate unsigned `darwin/x64` and `darwin/arm64` `.app` bundles. macOS live dogfood is pending; code signing and notarization are not performed; Gatekeeper trust is not claimed. Mobile/PWA real-device acceptance is next-cut work.

## P4 — Interactive Study

- [ ] Not started.

## P5 — Mirror Study Assistant

- [ ] Not started.

Completion here is mechanical only; it does not indicate review or acceptance.
