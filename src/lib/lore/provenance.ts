// Permanent canonical source identity (Stage 2A-P2R).
//
// There is ONE authored lore source: ToadAid/toadaid.github.io/lore/data.json.
// The repository and path below are PERMANENT architecture constants. They are
// not accepted from command-line values and do not change between Reader
// generations.
//
// The canonical commit is NOT a permanent law. It is GENERATION-SPECIFIC: an
// explicit, reviewed, full canonical commit SHA that advances between Reader
// generations. The Reader never follows mutable `main` at runtime. The current
// generation's commit (an example/current generation, not a production rule) is
// recorded in generated provenance and docs, never as "the only authorized
// commit."

/** Permanent canonical repository identity. Fixed forever unless separately
 *  governed; never supplied by the operator. */
export const CANONICAL_REPOSITORY = 'ToadAid/toadaid.github.io';

/** Permanent canonical source path. Fixed forever unless separately governed;
 *  never supplied by the operator. */
export const CANONICAL_PATH = 'lore/data.json';

/** Exact full canonical commit SHA form: 40 lowercase hexadecimal characters.
 *  The commit itself is advanceable; only its form is fixed. */
export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

export interface LoreSourceProvenance {
  schemaVersion: '1.0.0';
  repository: typeof CANONICAL_REPOSITORY;
  path: typeof CANONICAL_PATH;
  /** Exact full reviewed canonical commit SHA for this generation. Advanceable
   *  between Reader generations; never mutable `main`. */
  commit: string;
  sourceDigest: `sha256:${string}`;
  recordCount: number;
  generatedAt: string;
}