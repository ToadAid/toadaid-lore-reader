// Permanent canonical source identity (Stage 2A-P2R / P2R2).
//
// There is ONE authored lore source: ToadAid/toadaid.github.io/lore/data.json.
// The repository, branch, and path below are PERMANENT architecture constants.
// They are not accepted from command-line values and do not change between
// Reader generations.
//
// The canonical commit and source digest are NOT permanent law. They are
// GENERATION-SPECIFIC observed provenance: an exact, reviewed, full canonical
// commit SHA and its mechanically computed sha256 digest that advance between
// Reader generations. The Reader never follows mutable `main` at runtime, but
// the sync operator command resolves canonical `main` to one exact SHA and
// records that generation's commit + digest automatically. No Reader-side
// commit/digest constant is maintained per lore update.

/** Permanent canonical repository identity. Fixed forever unless separately
 *  governed; never supplied by the operator. */
export const CANONICAL_REPOSITORY = 'ToadAid/toadaid.github.io';

/** Permanent canonical branch. The single authored branch sync follows to
 *  resolve the current generation commit. Fixed forever unless separately
 *  governed; never supplied by the operator. */
export const CANONICAL_BRANCH = 'main';

/** Permanent canonical source path. Fixed forever unless separately governed;
 *  never supplied by the operator. */
export const CANONICAL_PATH = 'lore/data.json';

/** Exact full canonical commit SHA form: 40 lowercase hexadecimal characters.
 *  The commit itself is advanceable; only its form is fixed. */
export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/** Exact canonical source-digest form: `sha256:` + 64 lowercase hex characters.
 *  The digest itself is recomputed per generation; only its form is fixed. */
export const SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export interface LoreSourceProvenance {
  schemaVersion: '1.0.0';
  repository: typeof CANONICAL_REPOSITORY;
  path: typeof CANONICAL_PATH;
  /** Exact full reviewed canonical commit SHA for this generation. Advanceable
   *  between Reader generations; resolved automatically by canonical sync from
   *  canonical `main`. Never a hardcoded Reader constant. */
  commit: string;
  sourceDigest: `sha256:${string}`;
  recordCount: number;
  generatedAt: string;
}