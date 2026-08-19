# Historical artifact contract

Stage 2A-P1 establishes the authored canonical contract for historical media
artifacts. It is a contract only: no importer, manifest, Reader rendering,
binary fetching, or PWA behavior is implemented in this cut.

## Permanent source law

`ToadAid/toadaid.github.io/lore/data.json` remains the ONE canonical authored
lore-record source. Historical media binaries may later exist as immutable
companion evidence, but they do NOT become an independently authored lore
database. Generated Reader manifests are derived and are never authoritative
authoring surfaces.

## Legacy `img`

`img: string` is historical schema truth. It is not removed, migrated, or
reinterpreted as a preserved artifact. A non-empty legacy `img` means only
"canonical media reference exists" — it does not prove a binary exists, is
preserved, is rights-admitted, has been verified, or is safe for offline use.
A future importer may synthesize an internal generated candidate key from
legacy `img`, but that key must never become an `artifactId`, a Mirror
citation identity, or permanent historical identity.

## Artifact identity

Permanent artifact identity is explicitly authored. It is NOT array position,
ordinal position, a URL, or a SHA-256. Rejected: `record-id:img:0` and any
`<recordId>_MEDIA_001` whose semantics depend on array ordering (a pure-integer
slug is structurally rejected by `isValidArtifactId`).

Grammar: `<canonicalRecordId>_MEDIA_<slug>`

- `<canonicalRecordId>`: at least two underscore-separated segments of
  `[A-Za-z0-9]+` (matching observed canonical IDs like
  `TOBY_T1201_TheValidatorAwakening`).
- exactly one `_MEDIA_` separator (case-sensitive).
- `<slug>`: a non-empty human-authored stable string of `[A-Za-z0-9-]` that is
  not pure digits.

Example: `TOBY_T1201_TheValidatorAwakening_MEDIA_ValidatorAwakeningPlate`

Identity is archive-wide unique, immutable after canonical admission,
human-readable, stable under reordering and insertion of additional artifacts,
not content-derived, and usable as a future Mirror citation and Reader DOM
anchor.

## Digest law (governor override)

For any artifact claimed `PRESERVED_VERIFIED`, the expected SHA-256 MUST be
governed canonical metadata. The generated manifest may copy and verify that
expected digest; it must never invent it. (A mutable URL could serve bytes A
today and bytes B tomorrow; if the importer computed the "expected" digest from
whatever it received, both could appear valid.)

Digest format: `sha256:<64 lowercase hex>` (matching the provenance digest
shape). Uppercase, short, long, non-hex, and unprefixed values are rejected.

Required semantics:

- canonical expected digest absent → `REFERENCE_ONLY`
- canonical expected digest present + bytes unavailable → `MISSING`
- canonical expected digest present + observed digest mismatch → `DIGEST_MISMATCH`
- canonical expected digest present + observed digest exact match → `PRESERVED_VERIFIED`

No other path may claim preservation success. Rights gate the preservation
path: `unknown`/`restricted` rights with a preservation claim yield
`RIGHTS_NOT_ADMITTED` before any byte check.

## Source vs archive locator vs digest

Three distinct facts, never collapsed into one loose `source: string` field:

- `sourceUrl` — historical/original evidence location (the cited origin).
- `archivePath` — where an admitted preserved copy is stored under governed
  archival custody (e.g. `assets/lore/example.jpg`). Absent when no preserved
  copy is admitted.
- `expectedSha256` — exact admitted byte identity.

This is why the previous `MediaReference` scaffold (which collapsed citation
URL and archival locator into one `source` field, and mixed format and role in
one `kind` enum) was superseded. Repository search proved it was never imported
by any implementation.

## Type vs role

Two axes, never mixed in one enum.

- `type` (format): `image` | `video` | `audio` | `document`.
- `role` (evidential): `original-post-media` | `supporting-evidence` |
  `screenshot` | `contract-evidence` | `historical-page`.

Vocabulary is intentionally conservative; speculative roles are not added
without need.

## Rights

`rightsStatus` is one of `unknown` | `cleared` | `restricted` |
`public-domain`, and is required on authored artifacts to force explicit
authoring. The default architectural posture is `unknown`. Publicly accessible
is not rights cleared. This contract defines architecture semantics only; it
makes no legal determinations.

`offlineEligible` is NOT an independently authoritative authored boolean. It is
not part of the authored contract. Effective offline eligibility will later be
derived from rights + admission state + size/policy.

## Original vs derivative

An original historical artifact is primary evidence. A derivative (thumbnail,
poster, reader-sized image, transcoded video, preview GIF) is Reader/Workbench-
generated delivery material. Original and derivative are NOT the same identity:
a derivative carries its own digest and a binding back to the original
`artifactId`/digest, and never replaces original historical identity.
Derivatives remain generated delivery material unless a future explicit
governance decision says otherwise. No derivative implementation occurs in this
cut.

## Authored contract vs derived facts

Authored canonical metadata (`HistoricalArtifact`): `artifactId`, `type`,
`role`, `sourceUrl`, `archivePath?`, `expectedSha256?`, `rightsStatus`,
`attribution?`, `alt?`, `caption?`.

Derived / mechanically measurable / runtime facts — NOT in the authored
contract: `observedSha256`, `mimeType`, `byteSize`, `width`, `height`,
`duration`, `admissionState`, `effectiveOfflineEligible`, cache locators, PWA
generation. The authored-contract validator rejects these on input to enforce
the boundary. Separate derived interfaces (`ArtifactDerivedMetadata`,
`ArtifactAdmission`, `ArtifactObservation`) are defined for future clarity.

## Admission state (derived)

`REFERENCE_ONLY` | `PRESERVED_VERIFIED` | `MISSING` | `DIGEST_MISMATCH` |
`RIGHTS_NOT_ADMITTED` | `UNSUPPORTED_MEDIA`. States are derived from authored
facts + observed bytes; they are not stored canonically. A pure helper
`deriveAdmissionState` encodes the semantics above without network or file
lookup.

## Current evidence (from Stage 2A-P0)

The archive currently contains ZERO `PRESERVED_VERIFIED` artifacts: the two
legacy `img` references point at binaries that exist neither in the canonical
checkout, nor in reachable Git history, nor live (both URLs return HTTP 404
HTML). Any future importer must therefore render them as `REFERENCE_ONLY` /
`MISSING`, never as preserved evidence.