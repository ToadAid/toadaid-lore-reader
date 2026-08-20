// Canonical Git-object source binding (Stage 2A-P2R).
//
// The production canonical import path must NOT accept independently supplied
// source bytes plus an unrelated real commit SHA (that yields false
// provenance). Instead the importer mechanically obtains the canonical bytes
// from the exact Git object `<commit>:lore/data.json` inside a local canonical
// Git repository, using read-only Git plumbing.
//
// This helper is the narrow, testable binding between an exact reviewed commit
// and the canonical bytes. It:
//   - requires an exact full 40-char lowercase hex commit SHA (rejecting short
//     SHA, branch names, HEAD, tags, revision expressions, and commit:path
//     syntax supplied by the caller);
//   - verifies the local path is a usable Git repository;
//   - verifies the exact commit object exists LOCALLY (never fetches);
//   - verifies the canonical path exists at that commit;
//   - returns the bytes read from the Git object, never from the working tree.
//
// No network. No mutation (no checkout, branch switch, pull, fetch, reset). The
// canonical repository is treated strictly read-only.

import { execFileSync } from 'node:child_process';
import { CANONICAL_PATH, FULL_SHA_RE } from './provenance.ts';

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