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

## Public offline PWA

The public Pages build is explicitly admitted as a PWA with `PUBLIC_PWA=1`.
It creates a base-aware web manifest plus a service worker that precaches the
complete same-origin static Reader generation. Its cache identity is derived
from the exact Reader and canonical commits, and external historical media is
intentionally excluded. The deterministic `public/art/pond-archive/pwa-icon-192.png`
and `pwa-icon-512.png` installation icons are derivatives of the existing
repository-owned `pond-archive-lotus-moon.png` artwork. Ordinary local and
Electron builds do not register a service worker.

## Linux packaged offline Reader

After a governed canonical sync and ordinary `npm run build`, create the
read-only Linux x64 portable application with:

```sh
npm run desktop:package:linux
```

The disposable `release/The Pond Archive-linux-x64/` directory is an
end-user Reader only: it contains the verified static generation and no lore
sync control, canonical checkout, Node/npm requirement, or PWA runtime.

## Windows portable offline Reader

On the Linux packaging host, create the structurally validated Windows x64
portable directory with `npm run desktop:package:windows`. It is unsigned,
not an installer, and has no claimed SmartScreen trust. Live Windows dogfood
remains pending on a real Windows x64 machine.

## macOS portable offline Reader

On the Linux packaging host, create separate structurally validated bundles
with `npm run desktop:package:macos:x64` and
`npm run desktop:package:macos:arm64`. These are unsigned portable `.app`
bundles, not installers. macOS code signing and notarization are not
performed, Gatekeeper trust is not claimed, and live macOS dogfood remains
pending on real x64 and Apple Silicon Macs.
