# Lore Reader canonical architecture

The Lore Reader has four deliberately separate layers:

1. **Canonical archive** — `ToadAid/toadaid.github.io/lore/data.json` is the historical source of truth.
2. **ToadAid Portal** — the broader public experience; its content tree is not a substitute historical archive.
3. **Lore Reader** — this project, a static/generated consumer of the pinned canonical source.
4. **Mirror Study Assistant** — a future grounded study layer, not implemented here.

The importer is the sole route from the canonical source to the Reader
snapshot. Repository and path are permanent architecture constants; the commit
is an explicit, reviewed, advanceable generation:

```text
local canonical git repo + exact reviewed commit
  -> read-only git object <commit>:lore/data.json
  -> validating local importer
  -> generated/reader-snapshot.json + generated/LORE_SOURCE.json + generated/legacy-media-candidates.json
```

The importer derives bytes mechanically from the exact Git object, never from
caller-supplied source bytes and never from the working tree. Mutable `main` is
never Reader runtime authority. `generated/` is ignored except for `.gitkeep`;
generated lore records must never be hand-authored or edited. The snapshot
retains each canonical record as supplied and adds only clearly-derived reader
metadata.

## Evidence and media boundaries

`original` and `comment` remain separate canonical fields. The Reader does not combine them into a single body or classify commentary as fact. A future reader can classify material as primary source, documented fact, commentary, or interpretation without losing the source distinction.

Future media/artifact references use the `HistoricalArtifact` contract (see `docs/historical-artifact-contract.md`): an explicitly-authored stable `artifactId`, separate `type` and `role` axes, distinct `sourceUrl` and `archivePath`, a governed canonical `expectedSha256`, and `rightsStatus`. The earlier `MediaReference` scaffold was superseded. No gallery, player, downloader, remote embedding, or bundled third-party media is implemented yet.

## Offline and updates

A future core offline package may include application shell, canonical lore text, metadata, chronology, search/index, and provenance. Optional media is a separate package. P0 intentionally provides no service worker, manifest, cache, or update UI.

Updates run the local importer against a local canonical Git repository and an
explicit reviewed commit SHA. The importer reads the exact Git object, never
fetches a mutable branch, and never reaches the network; if the exact commit is
not present locally it refuses. Advancing to a newer reviewed commit is a
separate operator ceremony (fetch/update the canonical repository) followed by
importing that exact commit.

