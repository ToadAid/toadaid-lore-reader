# Lore Reader canonical architecture

The Lore Reader has four deliberately separate layers:

1. **Canonical archive** — `ToadAid/toadaid.github.io/lore/data.json` is the historical source of truth.
2. **ToadAid Portal** — the broader public experience; its content tree is not a substitute historical archive.
3. **Lore Reader** — this project, a static/generated consumer of the pinned canonical source.
4. **Mirror Study Assistant** — a future grounded study layer, not implemented here.

The importer is the sole route from canonical source bytes to the Reader snapshot:

```text
canonical file + repository + path + commit
  -> validating local importer
  -> generated/reader-snapshot.json + generated/LORE_SOURCE.json
```

`generated/` is ignored except for `.gitkeep`; generated lore records must never be hand-authored or edited. The snapshot retains each canonical record as supplied and adds only clearly-derived reader metadata.

## Evidence and media boundaries

`original` and `comment` remain separate canonical fields. The Reader does not combine them into a single body or classify commentary as fact. A future reader can classify material as primary source, documented fact, commentary, or interpretation without losing the source distinction.

Future media/artifact references use the `HistoricalArtifact` contract (see `docs/historical-artifact-contract.md`): an explicitly-authored stable `artifactId`, separate `type` and `role` axes, distinct `sourceUrl` and `archivePath`, a governed canonical `expectedSha256`, and `rightsStatus`. The earlier `MediaReference` scaffold was superseded. No gallery, player, downloader, remote embedding, or bundled third-party media is implemented yet.

## Offline and updates

A future core offline package may include application shell, canonical lore text, metadata, chronology, search/index, and provenance. Optional media is a separate package. P0 intentionally provides no service worker, manifest, cache, or update UI.

Updates must run the local importer with explicitly supplied source bytes and immutable provenance; it never fetches a mutable branch.

