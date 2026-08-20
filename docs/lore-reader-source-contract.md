# Lore Reader source contract

The canonical source identity has two distinct kinds of law:

**Permanent source identity (fixed forever unless separately governed):**

- repository: `ToadAid/toadaid.github.io`
- path: `lore/data.json`

These are Reader architecture constants. They are never accepted from
command-line values and never change between Reader generations. The importer
owns them; the operator cannot redefine canonical historical identity.

**Advanceable generation (generation-specific, not a permanent law):**

- commit: an EXACT, reviewed, full canonical commit SHA (40-char lowercase hex).

The commit is not hard-pinned forever. It advances between reviewed Reader
generations through an explicit reviewed SHA. The Reader never follows mutable
`main` at runtime and never auto-fetches. The current Reader generation's commit
`464933cecb6f508a980a66d37c8a7ef7add2f53d` remains valid historical provenance
for the current snapshot and may appear as an example/current generation; it is
NOT a production rule meaning "only this commit may ever be imported."

The importer mechanically obtains source bytes from the exact Git object
`<commit>:lore/data.json` inside a local canonical Git repository using
read-only Git plumbing. The caller cannot supply independent source bytes
independently of the claimed commit, so a claimed commit plus unrelated bytes
(false provenance) is impossible. The working-tree copy of `lore/data.json` is
never authority. If the exact commit is not present locally, the importer
refuses rather than fetching.

The source must parse as a JSON array. Each record must be an object with a non-empty string `id`, `date`, `title`, and `comment`. `original`, `url`, `img`, and `tags` are preserved when present and may be absent or empty, matching observed canonical variation. Unknown fields are retained verbatim.

Inspection of the pinned commit found 130 records and 130 unique `id` values. The upstream duplicate-ID repair is included in this reviewed source: `Trial of Patience` retains `TOBY_1756312669192`; `The Final Retweet` has the governed repair identity `TOBY_20250915_TheFinalRetweet`. The importer still rejects any duplicate ID; it does not resolve source defects by rewriting IDs, collapsing records, or using array position as identity.

`id` is the historical identity and is never replaced. Reader records expose it as `canonicalId`; no reader slug is generated in P0. If one is later added, it must be reversible to `canonicalId` and cannot replace it.

The archive `date` becomes only `archiveChronologyMarker`, never a `publishedAt` claim. Sorting is lexicographic by marker, then by canonical ID. This makes equal-marker ordering deterministic without claiming the input-array order proves history.

`LORE_SOURCE.json` contains `schemaVersion`, repository, path, commit, SHA-256 source digest, record count, and `generatedAt`. The digest identifies source bytes independently of the generation time. Invalid or non-exact provenance fails closed.
