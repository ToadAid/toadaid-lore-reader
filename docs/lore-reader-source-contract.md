# Lore Reader source contract

The accepted P0 source identity is exact:

- repository: `ToadAid/toadaid.github.io`
- path: `lore/data.json`
- commit: `041c2ea6fda8284f61fb35c7101d083623d235ba`

The source must parse as a JSON array. Each record must be an object with a non-empty string `id`, `date`, `title`, and `comment`. `original`, `url`, `img`, and `tags` are preserved when present and may be absent or empty, matching observed canonical variation. Unknown fields are retained verbatim.

Inspection of the pinned commit found 130 records and 129 unique `id` values: `TOBY_1756312669192` occurs twice (array indexes 111 and 113). The importer therefore refuses the exact current source under the duplicate-ID rule; it does not resolve this historical-source defect by rewriting an ID, collapsing a record, or using array position as identity. A source-authorized correction or an explicitly approved identity policy is required before a canonical snapshot can be generated.

`id` is the historical identity and is never replaced. Reader records expose it as `canonicalId`; no reader slug is generated in P0. If one is later added, it must be reversible to `canonicalId` and cannot replace it.

The archive `date` becomes only `archiveChronologyMarker`, never a `publishedAt` claim. Sorting is lexicographic by marker, then by canonical ID. This makes equal-marker ordering deterministic without claiming the input-array order proves history.

`LORE_SOURCE.json` contains `schemaVersion`, repository, path, commit, SHA-256 source digest, record count, and `generatedAt`. The digest identifies source bytes independently of the generation time. Invalid or non-exact provenance fails closed.
