// Canonical Git-object source binding (Stage 2A-P2R / P2R2).
//
// There are two layers here:
//
//   1. EXACT-COMMIT PRIMITIVE (readCanonicalBytes) — the deterministic engine.
//      It binds an exact reviewed full commit SHA to the canonical bytes read
//      from the Git object `<commit>:lore/data.json` using read-only plumbing.
//      It NEVER fetches: a missing local commit is refused. It never mutates.
//      This is the lower-level primitive used for tests, replay, historical
//      proof, and exact generation reproduction (Stage 2A-P2R2 §13).
//
//   2. CANONICAL-MAIN SYNC (resolveCanonicalMain) — the operator sync layer.
//      It is explicitly allowed to synchronize the canonical repository's
//      remote-tracking `main` (a narrow fetch of origin/main) so it can observe
//      the current canonical generation. It resolves `main` to ONE exact full
//      SHA and freezes it, then the exact-commit primitive reads the bytes from
//      that frozen SHA. The fetch mutates canonical-repo Git metadata/remotes
//      only as mechanically required; it never checks out, resets, merges,
//      rebases, commits, edits, stashes, cleans, or deletes (Stage 2A-P2R2 §11).
//
// The production canonical import path must NOT accept independently supplied
// source bytes plus an unrelated real commit SHA (that yields false
// provenance). Bytes are mechanically obtained from the exact Git object inside
// a local canonical Git repository, never from the dirty working tree.

import { execFileSync } from 'node:child_process';
import { CANONICAL_BRANCH, CANONICAL_PATH, CANONICAL_REPOSITORY, FULL_SHA_RE } from './provenance.ts';

/** Bytes read from the exact canonical Git object. */
export interface CanonicalGitSourceBytes {
  /** The exact full commit SHA the bytes were bound to. */
  commit: string;
  /** The permanent canonical path the bytes were read from. */
  path: typeof CANONICAL_PATH;
  /** Canonical bytes from `<commit>:lore/data.json` (Git object, not worktree). */
  bytes: string;
}

function fail(message: string): never {
  throw new Error(`Canonical git source refused: ${message}`);
}

/** True when `commit` is an exact full 40-char lowercase hex Git SHA-1.
 *  Rejects short SHA, branch names, HEAD, tags, revision expressions, and any
 *  `commit:path` syntax (the caller never supplies the path binding). */
export function isFullCommitSha(commit: unknown): commit is string {
  return typeof commit === 'string' && FULL_SHA_RE.test(commit);
}

/** Throw (fail closed) unless `commit` is an exact full canonical SHA. */
export function assertFullCommitSha(commit: unknown): asserts commit is string {
  if (!isFullCommitSha(commit)) {
    fail(`commit is not an exact 40-character lowercase hex SHA: ${String(commit)}`);
  }
}

/** Verify `canonicalRepo` is a usable Git repository sufficient for an exact
 *  object lookup. Read-only; never mutates. */
export function assertGitRepository(canonicalRepo: string): void {
  if (typeof canonicalRepo !== 'string' || canonicalRepo.length === 0) {
    fail('canonical-repo path is missing');
  }
  try {
    execFileSync('git', ['-C', canonicalRepo, 'rev-parse', '--git-dir'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
  } catch {
    fail(`canonical-repo is not a usable git repository: ${canonicalRepo}`);
  }
}

/** Run a read-only Git plumbing command inside `canonicalRepo`. Returns stdout
 *  (utf8) on success; throws a classified error on failure. Never mutates. */
function gitRead(canonicalRepo: string, args: string[], failure: string): string {
  try {
    return execFileSync('git', ['-C', canonicalRepo, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown })?.stderr ?? '');
    // Surface the classified failure; include git's stderr for diagnosis.
    fail(`${failure}${stderr ? ` (${stderr.trim()})` : ''}`);
  }
}

/**
 * Read the canonical bytes from the exact Git object `<commit>:lore/data.json`
 * inside the local canonical Git repository `canonicalRepo`.
 *
 * Fail-closed classifications:
 *   - commit not a full SHA                    -> commit format refused
 *   - `canonicalRepo` not a usable git repo    -> canonical-repo refused
 *   - exact commit object not present locally  -> CANONICAL_COMMIT_NOT_AVAILABLE_LOCALLY
 *   - canonical path absent at the commit      -> CANONICAL_SOURCE_PATH_NOT_PRESENT_AT_COMMIT
 *
 * No fetch is ever performed: a missing local commit is refused, never
 * retrieved. No working-tree file is ever read.
 */
export function readCanonicalBytes(canonicalRepo: string, commit: string): CanonicalGitSourceBytes {
  assertFullCommitSha(commit);
  assertGitRepository(canonicalRepo);

  // Verify the exact commit object exists locally (and resolves as a commit).
  // `cat-file -e <sha>^{commit}` exits 0 only when the object exists and peels
  // to a commit; it exits non-zero for a missing object or a non-commit object.
  gitRead(
    canonicalRepo,
    ['cat-file', '-e', `${commit}^{commit}`],
    `CANONICAL_COMMIT_NOT_AVAILABLE_LOCALLY: ${commit}`,
  );

  // Read the canonical path from that exact commit. `show <commit>:<path>`
  // writes the blob bytes to stdout, or fails when the path is absent at that
  // commit.
  const bytes = gitRead(
    canonicalRepo,
    ['show', `${commit}:${CANONICAL_PATH}`],
    `CANONICAL_SOURCE_PATH_NOT_PRESENT_AT_COMMIT: ${CANONICAL_PATH} at ${commit}`,
  );

  return { commit, path: CANONICAL_PATH, bytes };
}

// ───────────────────────── canonical-main sync (Stage 2A-P2R2) ─────────────────────────
//
// The exact-commit primitive above is deterministic and fetch-free. The sync
// layer below is the ONE place allowed to observe canonical `main`: it performs
// a narrow fetch of the canonical remote-tracking `main`, resolves that moving
// branch to ONE exact full SHA, and freezes it. The frozen SHA is then handed to
// the exact-commit primitive so the entire generation reads bytes from one
// frozen object — no race where provenance comes from one revision and bytes
// from another.

/**
 * Normalize a Git remote URL to its `owner/name` slug, stripping scheme, user,
 * host, and a trailing `.git`. Used to verify a canonical-repo clone actually
 * points at the permanent canonical repository. Reads the RAW configured URL
 * (git applies `insteadOf` only during fetch/ls-remote, not here), so this is
 * the literal configured origin, not a rewrite.
 */
export function normalizeRemoteUrl(url: string): string {
  let u = url.trim();
  if (u.endsWith('.git')) u = u.slice(0, -4);
  // Strip an optional scheme and an optional `user@` userinfo prefix.
  u = u.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '');
  u = u.replace(/^[^/@]*@/, '');
  // scp-like form `host:owner/name` -> `host/owner/name` (first colon only).
  const colon = u.indexOf(':');
  if (colon !== -1 && !u.slice(0, colon).includes('/')) u = u.slice(0, colon) + '/' + u.slice(colon + 1);
  const segments = u.split('/').filter((segment) => segment.length > 0);
  return segments.slice(-2).join('/');
}

/**
 * Verify `canonicalRepo` has an `origin` remote whose configured URL corresponds
 * to the permanent canonical repository. Read-only; never mutates. Fails closed
 * when origin is absent or points elsewhere, so the sync command cannot be
 * pointed at an arbitrary non-canonical repository.
 */
export function assertCanonicalRemote(canonicalRepo: string): void {
  let url: string;
  try {
    const result = execFileSync('git', ['-C', canonicalRepo, 'config', '--get', 'remote.origin.url'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    url = result.trim();
  } catch {
    fail('CANONICAL_REMOTE_ORIGIN_MISSING: origin remote is not configured');
  }
  if (url.length === 0) fail('CANONICAL_REMOTE_ORIGIN_MISSING: origin remote URL is empty');
  const slug = normalizeRemoteUrl(url);
  if (slug !== CANONICAL_REPOSITORY) {
    fail(`CANONICAL_REMOTE_NOT_CANONICAL: origin ${slug} is not ${CANONICAL_REPOSITORY}`);
  }
}

/**
 * Resolve canonical `main` to ONE exact full 40-char commit SHA and freeze it for
 * the generation. Steps (Stage 2A-P2R2 §10):
 *   1. verify --canonical-repo is a usable Git repository;
 *   2. verify it corresponds to the canonical repository (origin == canonical);
 *   3. synchronize only the canonical remote-tracking `main` (narrow fetch);
 *   4. resolve current canonical `main` to one exact full SHA;
 *   5. freeze that SHA (returned; the caller reads bytes from it only).
 *
 * The narrow fetch may mutate the canonical-repo remote-tracking ref + FETCH_HEAD
 * metadata only (Stage 2A-P2R2 §11). It never checks out, resets, merges,
 * rebases, commits, edits, stashes, cleans, or deletes. Dirty working-tree
 * contents are irrelevant: bytes are later read from the frozen Git object by
 * the exact-commit primitive.
 */
export function resolveCanonicalMain(canonicalRepo: string): string {
  assertGitRepository(canonicalRepo);
  assertCanonicalRemote(canonicalRepo);

  // Narrow fetch of the canonical main branch only. The explicit single-ref
  // refspec guarantees the remote-tracking ref is updated, then resolved below.
  gitRead(
    canonicalRepo,
    ['fetch', 'origin', `+refs/heads/${CANONICAL_BRANCH}:refs/remotes/origin/${CANONICAL_BRANCH}`],
    'CANONICAL_MAIN_FETCH_FAILED',
  );

  const sha = gitRead(
    canonicalRepo,
    ['rev-parse', `refs/remotes/origin/${CANONICAL_BRANCH}`],
    'CANONICAL_MAIN_RESOLUTION_FAILED',
  ).trim();

  if (!isFullCommitSha(sha)) {
    fail(`CANONICAL_MAIN_NOT_FULL_SHA: resolved ${CANONICAL_BRANCH} is not an exact 40-char SHA: ${sha}`);
  }
  return sha;
}