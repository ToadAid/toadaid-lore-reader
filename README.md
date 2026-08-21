# ToadAid Lore Reader

Static reader foundation for the historical lore archive. This repository is a
generated consumer, not an independently authored lore archive.

## Canonical source

There is ONE authored lore source:

- repository: `ToadAid/toadaid.github.io`
- path: `lore/data.json`

These are PERMANENT Reader architecture constants. They are never supplied by the
operator and never change between Reader generations.

The canonical commit is GENERATION-SPECIFIC, not a permanent law. Every generated
Reader snapshot records the exact resolved commit and source digest in
`generated/LORE_SOURCE.json`. The static browser Reader never fetches canonical
lore at runtime.

## Deterministic exact-commit importer

```sh
npm run import:canonical -- \
  --canonical-repo /path/to/toadaid.github.io \
  --commit <full-reviewed-canonical-sha>
```

The operator supplies only:

1. the local canonical Git repository location (`--canonical-repo`); and
2. the exact full reviewed canonical commit SHA to import (`--commit`, 40-char
   lowercase hex).

The importer owns the permanent identity (repository + path) as architecture
constants — the caller cannot redefine them. Source bytes are mechanically
obtained from the exact Git object `<commit>:lore/data.json` inside the local
canonical repository using read-only Git plumbing. The caller cannot supply
independent source bytes, so a claimed commit plus unrelated bytes (false
provenance) is impossible. The working-tree copy of `lore/data.json` is never
authority.

If the exact commit is not present locally, the importer REFUSES — it never
fetches, pulls, or otherwise reaches the network. To advance to a newer
reviewed commit, run a separate operator ceremony (fetch/update the canonical
repository) and then import that exact commit.

The importer writes derived JSON only under `generated/`. Do not hand-edit those
files.

## Canonical-main sync

For a local or desktop operator surface, the P2R2 sync command accepts only the
local canonical Git checkout location:

```sh
npm run sync:canonical -- \
  --canonical-repo /path/to/toadaid.github.io
```

It verifies the canonical remote, fetches canonical `main`, freezes the resolved
full SHA, reads the exact Git-object bytes, validates the complete generated
generation, and computes provenance automatically. The caller does not provide a
commit, digest, source path, repository identity, or source bytes.

For the public Reader, GitHub Actions polls on a five-minute cron schedule (not a
real-time or exact-to-the-minute guarantee), and also runs on manual dispatch and
Reader `main` pushes. The workflow checks out the canonical repository locally,
calls the same `sync:canonical` boundary, validates and builds the static Reader
with the `/toadaid-lore-reader/` project base, then deploys to GitHub Pages only
after full success. Invalid canonical source or a failed build cannot replace the
previous public deployment. Generated snapshots remain uncommitted derived
material.

## Local commands

```sh
npm test
npm run build
```
