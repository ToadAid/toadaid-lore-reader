# P1 core reader handoff

`loadGeneratedArchive()` in `src/lib/lore/archive-cover-state.ts` is the only reader-side boundary for ignored generated snapshot/provenance artifacts. It fails closed when present artifacts are invalid and returns unavailable only when both are absent.

Routes: `/` is the cover, `/chronicle/` groups deterministic `sortKey` chronology by year, and `/record/<canonicalId>/` is generated statically from the same ordered records. Chapters retain canonical `original` and `comment` separately; Evidence Lens maps record fields separately from snapshot provenance. The inline reading-mode enhancement only hides/shows these already-rendered sections and has no persistence.

Remaining P1: reading progress, Continue Reading persistence, bookmarks, and appearance controls. Deliberate exclusions: PWA/offline, artifacts/audio, search, Study Mode, Mirror, accounts, analytics, and any runtime canonical fetch.

Validate with `npm test`, `npm run build`, and `git diff --check`. For a verified preview, materialize the pinned canonical Git object, run `npm run import:canonical`, then `npm run dev -- --host 127.0.0.1 --port 4321`.
