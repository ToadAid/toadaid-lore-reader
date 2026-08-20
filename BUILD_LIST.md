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
- [ ] Bookmarks.
- [ ] Original / Commentary / Both.
- [ ] Appearance / font controls.

## P2 — Artifacts + Music

- [x] Historical artifact contract defined (Stage 2A-P1): authored identity, governed digest, source vs archive locator, type vs role, rights, original vs derivative, derived admission state. No importer, manifest, rendering, or fetching yet.
- [x] Legacy media candidate manifest generated (Stage 2A-P2): importer emits a provenance-bound `generated/legacy-media-candidates.json` from legacy `img`; deterministic `legacy-img:<id>` candidate keys (NOT artifactIds); REFERENCE_ONLY state; fail-closed validation. No rendering, fetching, or PWA yet.
- [x] Canonical source-advancement binding repair (Stage 2A-P2R): the importer no longer hard-pins one canonical commit. Repository/path are permanent architecture constants; the commit is an explicit, reviewed, advanceable full SHA. Source bytes are mechanically bound to the exact Git object `<commit>:lore/data.json` via read-only Git plumbing (no caller-supplied bytes, no working-tree authority, no network). Mutability/advancement + byte-binding + fail-closed proofs added. The current generation commit `464933cecb6f508a980a66d37c8a7ef7add2f53d` remains the current imported generation, not a permanent import law.
- [ ] Not otherwise started.

## P3 — PWA / Offline

- [ ] Not started.

## P4 — Interactive Study

- [ ] Not started.

## P5 — Mirror Study Assistant

- [ ] Not started.

Completion here is mechanical only; it does not indicate review or acceptance.
