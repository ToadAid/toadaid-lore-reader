# ToadAid Lore Reader

Static reader foundation for the historical lore archive. This repository is a
generated consumer, not an independently authored lore archive.

## Canonical source

There is ONE authored lore source:

- repository: `ToadAid/toadaid.github.io`
- path: `lore/data.json`

These are PERMANENT Reader architecture constants. They are never supplied by the
operator and never change between Reader generations.

The canonical commit is GENERATION-SPECIFIC, not a permanent law. The Reader never
follows mutable `main` at runtime. Each generation imports an explicit, reviewed,
full canonical commit SHA; the commit may advance between reviewed Reader
generations, but the importer never auto-fetches or follows `main`. The current
generation's commit (an example/current generation, not a permanent rule) is
recorded in `generated/LORE_SOURCE.json`.

## Importing canonical lore

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

## Local commands

```sh
npm test
npm run build
```