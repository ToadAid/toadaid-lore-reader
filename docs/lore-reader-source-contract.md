# Lore Reader source contract

The accepted P0 source identity is exact:

- repository: `ToadAid/toadaid.github.io`
- path: `lore/data.json`
- commit: `464933cecb6f508a980a66d37c8a7ef7add2f53d`

The source must parse as a JSON array. Each record must be an object with a non-empty string `id`, `date`, `title`, and `comment`. `original`, `url`, `img`, and `tags` are preserved when present and may be absent or empty, matching observed canonical variation. Unknown fields are retained verbatim.

Inspection of the pinned commit found 130 records and 130 unique `id` values. The upstream duplicate-ID repair is included in this reviewed source: `Trial of Patience` retains `TOBY_1756312669192`; `The Final Retweet` has the governed repair identity `TOBY_20250915_TheFinalRetweet`. The importer still rejects any duplicate ID; it does not resolve source defects by rewriting IDs, collapsing records, or using array position as identity.

`id` is the historical identity and is never replaced. Reader records expose it as `canonicalId`; no reader slug is generated in P0. If one is later added, it must be reversible to `canonicalId` and cannot replace it.

The archive `date` becomes only `archiveChronologyMarker`, never a `publishedAt` claim. Sorting is lexicographic by marker, then by canonical ID. This makes equal-marker ordering deterministic without claiming the input-array order proves history.

`LORE_SOURCE.json` contains `schemaVersion`, repository, path, commit, SHA-256 source digest, record count, and `generatedAt`. The digest identifies source bytes independently of the generation time. Invalid or non-exact provenance fails closed.
