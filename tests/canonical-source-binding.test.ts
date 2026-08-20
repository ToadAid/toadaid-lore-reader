import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CANONICAL_REPOSITORY, CANONICAL_PATH } from '../src/lib/lore/provenance.ts';
import {
  readCanonicalBytes,
  assertGitRepository,
  isFullCommitSha,
} from '../src/lib/lore/canonical-git-source.ts';
import { buildSnapshot } from '../scripts/import-canonical-lore.mjs';
import {
  buildLegacyMediaCandidateManifest,
  validateLegacyMediaCandidateManifest,
} from '../src/lib/lore/legacy-media-candidates.ts';

// ---------------------------------------------------------------------------
// Stage 2A-P2R canonical source-advancement + byte-binding proofs.
//
// These tests prove the importer architecture can advance the canonical commit
// between reviewed Reader generations while repository/path identity stays
// permanently fixed, and that source bytes are mechanically bound to the exact
// Git object `<commit>:lore/data.json` (never caller-supplied, never the dirty
// working tree). All proof uses temporary LOCAL Git repository fixtures — no
// network, no real GitHub state.
// ---------------------------------------------------------------------------

const REPO = resolve('.');

function digest(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function git(repo: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'P2R Test',
      GIT_AUTHOR_EMAIL: 'p2r@test.local',
      GIT_COMMITTER_NAME: 'P2R Test',
      GIT_COMMITTER_EMAIL: 'p2r@test.local',
      GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z',
    },
    input,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

interface FixtureRepo {
  repo: string;
  noPathCommit: string; // commit without lore/data.json
  commitA: string; // commit with fixture A
  commitB: string; // commit with fixture B (on top of A)
}

const fixtureA = JSON.stringify([
  { id: 'TOBY_A', date: '2024-01-01', title: 'A', comment: 'c', original: 'o', url: '', img: 'https://toadaid.github.io/assets/lore/a.jpg', tags: 't' },
]);
const fixtureB = JSON.stringify([
  { id: 'TOBY_B', date: '2024-01-02', title: 'B', comment: 'c', original: 'o', url: '', img: 'https://toadaid.github.io/assets/lore/b.jpg', tags: 't' },
]);
const zeroFixture = JSON.stringify([
  { id: 'TOBY_Z1', date: '2024-01-03', title: 'Z1', comment: 'c', img: '' },
  { id: 'TOBY_Z2', date: '2024-01-04', title: 'Z2', comment: 'c' },
]);

function makeFixtureRepo(): FixtureRepo {
  const repo = mkdtempSync(join(tmpdir(), 'p2r-canonical-'));
  git(repo, ['init', '-q']);
  // Commit 1: README only — NO lore/data.json at this commit.
  writeFileSync(join(repo, 'README.md'), '# canonical fixture\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'initial: no lore yet']);
  const noPathCommit = git(repo, ['rev-parse', 'HEAD']);
  // Commit 2: add lore/data.json = fixture A.
  mkdirSync(join(repo, 'lore'), { recursive: true });
  writeFileSync(join(repo, CANONICAL_PATH), fixtureA);
  git(repo, ['add', CANONICAL_PATH]);
  git(repo, ['commit', '-q', '-m', 'add lore A']);
  const commitA = git(repo, ['rev-parse', 'HEAD']);
  // Commit 3: change lore/data.json = fixture B.
  writeFileSync(join(repo, CANONICAL_PATH), fixtureB);
  git(repo, ['add', CANONICAL_PATH]);
  git(repo, ['commit', '-q', '-m', 'change lore B']);
  const commitB = git(repo, ['rev-parse', 'HEAD']);
  return { repo, noPathCommit, commitA, commitB };
}

const repos: string[] = [];
test.after?.(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

function freshRepo(): FixtureRepo {
  const r = makeFixtureRepo();
  repos.push(r.repo);
  return r;
}

// ---------------------------------------------------------------------------
// 1-2. Permanent canonical identity is architecture constants.
// ---------------------------------------------------------------------------

test('canonical repository identity is permanently ToadAid/toadaid.github.io', () => {
  const { repo, commitA } = freshRepo();
  const { bytes, commit, path } = readCanonicalBytes(repo, commitA);
  assert.equal(bytes, fixtureA);
  assert.equal(commit, commitA);
  assert.equal(path, CANONICAL_PATH);
  const { source } = buildSnapshot(bytes, { repository: CANONICAL_REPOSITORY, path, commit });
  assert.equal(source.repository, CANONICAL_REPOSITORY);
});

test('canonical source path is permanently lore/data.json', () => {
  const { repo, commitA } = freshRepo();
  const result = readCanonicalBytes(repo, commitA);
  assert.equal(result.path, CANONICAL_PATH);
  assert.equal(result.bytes, fixtureA);
});

// ---------------------------------------------------------------------------
// 3-5. Production CLI no longer accepts caller-provided identity or bytes.
// ---------------------------------------------------------------------------

function runImporter(args: string[]): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync('node', [resolve(REPO, 'scripts/import-canonical-lore.mjs'), ...args], {
    encoding: 'utf8',
    cwd: REPO,
  });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

test('the production CLI does not accept caller-provided repository identity', () => {
  // The new CLI owns repository identity as a permanent constant; the obsolete
  // --repository flag is rejected (no --source needed to trigger it).
  const r = runImporter(['--repository', 'other/repo', '--commit', '464933cecb6f508a980a66d37c8a7ef7add2f53d']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--repository is no longer accepted/);
});

test('the production CLI does not accept caller-provided source-path identity', () => {
  const r = runImporter(['--source-path', 'other.json', '--commit', '464933cecb6f508a980a66d37c8a7ef7add2f53d']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--source-path is no longer accepted/);
});

test('the production CLI does not accept arbitrary independent source bytes (false provenance closed)', () => {
  // The old weak attack — claimed commit + independent source file — is no
  // longer expressible: --source is rejected outright, so bytes cannot be
  // supplied independently of the claimed commit.
  const r = runImporter(['--source', '/tmp/x.json', '--repository', CANONICAL_REPOSITORY, '--source-path', CANONICAL_PATH, '--commit', '464933cecb6f508a980a66d37c8a7ef7add2f53d']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--source is no longer accepted/);
});

// ---------------------------------------------------------------------------
// 6-11. Commit input validation (exact full SHA required).
// ---------------------------------------------------------------------------

test('exact full commit SHA is required and validated as a SHA form', () => {
  assert.equal(isFullCommitSha('464933cecb6f508a980a66d37c8a7ef7add2f53d'), true);
  assert.equal(isFullCommitSha('MAIN'), false);
});

test('short SHA is refused', () => {
  const { repo, commitA } = freshRepo();
  assert.throws(() => readCanonicalBytes(repo, commitA.slice(0, 7)), /lowercase hex SHA/);
});

test('branch name is refused', () => {
  const { repo } = freshRepo();
  assert.throws(() => readCanonicalBytes(repo, 'main'), /lowercase hex SHA/);
});

test('malformed SHA is refused', () => {
  const { repo } = freshRepo();
  assert.throws(() => readCanonicalBytes(repo, 'not-a-sha'), /lowercase hex SHA/);
});

test('HEAD and revision expressions are refused', () => {
  const { repo } = freshRepo();
  assert.throws(() => readCanonicalBytes(repo, 'HEAD'), /lowercase hex SHA/);
  assert.throws(() => readCanonicalBytes(repo, 'HEAD~1'), /lowercase hex SHA/);
});

test('nonexistent exact SHA is refused locally (no fetch)', () => {
  const { repo } = freshRepo();
  assert.throws(() => readCanonicalBytes(repo, '0'.repeat(40)), /CANONICAL_COMMIT_NOT_AVAILABLE_LOCALLY/);
});

// ---------------------------------------------------------------------------
// 12-13. Commit must contain lore/data.json; bytes come from the Git object.
// ---------------------------------------------------------------------------

test('a commit lacking lore/data.json is refused', () => {
  const { repo, noPathCommit } = freshRepo();
  assert.throws(() => readCanonicalBytes(repo, noPathCommit), /CANONICAL_SOURCE_PATH_NOT_PRESENT_AT_COMMIT/);
});

test('bytes are read from the exact commit:path Git object', () => {
  const { repo, commitA, commitB } = freshRepo();
  assert.equal(readCanonicalBytes(repo, commitA).bytes, fixtureA);
  assert.equal(readCanonicalBytes(repo, commitB).bytes, fixtureB);
});

// ---------------------------------------------------------------------------
// 14. Dirty working-tree lore/data.json cannot alter import of a pinned commit.
// ---------------------------------------------------------------------------

test('dirty working-tree lore/data.json cannot alter import of a pinned commit', () => {
  const { repo, commitA } = freshRepo();
  // Mutate the working tree WITHOUT committing.
  writeFileSync(join(repo, CANONICAL_PATH), fixtureB);
  const { bytes, commit } = readCanonicalBytes(repo, commitA);
  assert.equal(commit, commitA);
  assert.equal(bytes, fixtureA); // the pinned commit, not the dirty tree
});

// ---------------------------------------------------------------------------
// 15-19. Two different fixture commits produce two legitimate generations.
// ---------------------------------------------------------------------------

test('two fixture commits produce two different legitimate generations', () => {
  const { repo, commitA, commitB } = freshRepo();
  const a = readCanonicalBytes(repo, commitA);
  const b = readCanonicalBytes(repo, commitB);

  const genA = buildSnapshot(a.bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: a.commit });
  const genB = buildSnapshot(b.bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: b.commit });

  assert.equal(genA.source.commit, commitA);
  assert.equal(genB.source.commit, commitB);
  assert.notEqual(genA.source.commit, genB.source.commit);
  assert.equal(genA.source.sourceDigest, digest(fixtureA));
  assert.equal(genB.source.sourceDigest, digest(fixtureB));
  assert.notEqual(genA.source.sourceDigest, genB.source.sourceDigest);
  assert.equal(genA.snapshot.records[0].canonicalId, 'TOBY_A');
  assert.equal(genB.snapshot.records[0].canonicalId, 'TOBY_B');
});

test('repository and path remain fixed across generations', () => {
  const { repo, commitA, commitB } = freshRepo();
  const genA = buildSnapshot(readCanonicalBytes(repo, commitA).bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: commitA });
  const genB = buildSnapshot(readCanonicalBytes(repo, commitB).bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: commitB });
  assert.equal(genA.source.repository, CANONICAL_REPOSITORY);
  assert.equal(genB.source.repository, CANONICAL_REPOSITORY);
  assert.equal(genA.source.path, CANONICAL_PATH);
  assert.equal(genB.source.path, CANONICAL_PATH);
});

test('sourceDigest corresponds to the exact selected commit bytes', () => {
  const { repo, commitA } = freshRepo();
  const a = readCanonicalBytes(repo, commitA);
  const gen = buildSnapshot(a.bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: commitA });
  assert.equal(gen.source.sourceDigest, digest(fixtureA));
});

test('Reader snapshot and candidate manifest share the same generation', () => {
  const { repo, commitA } = freshRepo();
  const a = readCanonicalBytes(repo, commitA);
  const { source, snapshot } = buildSnapshot(a.bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: commitA });
  const manifest = buildLegacyMediaCandidateManifest(snapshot.records, source);
  validateLegacyMediaCandidateManifest(manifest, snapshot);
  assert.equal(manifest.provenance.commit, source.commit);
  assert.equal(manifest.provenance.sourceDigest, source.sourceDigest);
  assert.equal(manifest.candidateCount, 1);
  assert.equal(manifest.candidates[0].canonicalId, 'TOBY_A');
  assert.equal(manifest.candidates[0].state, 'REFERENCE_ONLY');
});

// ---------------------------------------------------------------------------
// 28. Zero-candidate fixture still works through the git-object path.
// ---------------------------------------------------------------------------

function makeZeroCandidateRepo(): { repo: string; commit: string } {
  const repo = mkdtempSync(join(tmpdir(), 'p2r-zero-'));
  repos.push(repo);
  git(repo, ['init', '-q']);
  writeFileSync(join(repo, 'README.md'), '# zero\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'init']);
  mkdirSync(join(repo, 'lore'), { recursive: true });
  writeFileSync(join(repo, CANONICAL_PATH), zeroFixture);
  git(repo, ['add', CANONICAL_PATH]);
  git(repo, ['commit', '-q', '-m', 'zero candidates']);
  return { repo, commit: git(repo, ['rev-parse', 'HEAD']) };
}

test('a zero-candidate fixture still works through the git-object import path', () => {
  const { repo, commit } = makeZeroCandidateRepo();
  const a = readCanonicalBytes(repo, commit);
  const { source, snapshot } = buildSnapshot(a.bytes, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit });
  const manifest = buildLegacyMediaCandidateManifest(snapshot.records, source);
  validateLegacyMediaCandidateManifest(manifest, snapshot);
  assert.equal(manifest.candidateCount, 0);
  assert.deepEqual(manifest.candidates, []);
});

// ---------------------------------------------------------------------------
// 11 + failure proofs: non-Git repo, missing arguments.
// ---------------------------------------------------------------------------

test('a non-Git canonical-repo path is refused', () => {
  const notGit = mkdtempSync(join(tmpdir(), 'p2r-notgit-'));
  repos.push(notGit);
  assert.throws(() => assertGitRepository(notGit), /not a usable git repository/);
  assert.throws(() => readCanonicalBytes(notGit, '464933cecb6f508a980a66d37c8a7ef7add2f53d'), /not a usable git repository/);
});

test('a missing canonical-repo argument is refused by the CLI', () => {
  const r = runImporter(['--commit', '464933cecb6f508a980a66d37c8a7ef7add2f53d']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing --canonical-repo/);
});

test('a missing commit argument is refused by the CLI', () => {
  const r = runImporter(['--canonical-repo', '/home/tommy/toadaid.github.io']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing --commit/);
});

test('a malformed commit argument is refused by the CLI', () => {
  const r = runImporter(['--canonical-repo', '/home/tommy/toadaid.github.io', '--commit', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lowercase hex SHA/);
});

// ---------------------------------------------------------------------------
// 27. No network: a missing local commit is refused, never fetched.
// ---------------------------------------------------------------------------

test('no network is performed: a missing local commit is refused, not fetched', () => {
  const { repo } = freshRepo();
  // A full SHA that does not exist locally must be refused, proving the
  // importer does not reach out to a remote to retrieve it.
  assert.throws(() => readCanonicalBytes(repo, '0'.repeat(40)), /CANONICAL_COMMIT_NOT_AVAILABLE_LOCALLY/);
});

// ---------------------------------------------------------------------------
// 20-26. Current real generation proof against the local canonical repository.
//
// Runs only when the operator's local canonical repository and the current
// Reader-generation commit are present (the default operator environment). In
// any other environment it skips rather than fails — the binding mechanism is
// already proven by the local-fixture tests above.
// ---------------------------------------------------------------------------

const REAL_CANONICAL_REPO = process.env.P2R_CANONICAL_REPO ?? '/home/tommy/toadaid.github.io';
const REAL_CANONICAL_COMMIT = '464933cecb6f508a980a66d37c8a7ef7add2f53d';

function realRepoAvailable(): boolean {
  if (!existsSync(REAL_CANONICAL_REPO)) return false;
  const probe = spawnSync('git', ['-C', REAL_CANONICAL_REPO, 'cat-file', '-e', `${REAL_CANONICAL_COMMIT}^{commit}`], { stdio: 'ignore' });
  return probe.status === 0;
}

test('the current real canonical generation imports from the local canonical repo', { skip: !realRepoAvailable() && 'local canonical repo/commit not present' }, () => {
  const { bytes, commit, path } = readCanonicalBytes(REAL_CANONICAL_REPO, REAL_CANONICAL_COMMIT);
  const { source, snapshot } = buildSnapshot(bytes, { repository: CANONICAL_REPOSITORY, path, commit });
  const manifest = buildLegacyMediaCandidateManifest(snapshot.records, source);
  validateLegacyMediaCandidateManifest(manifest, snapshot);

  assert.equal(source.repository, CANONICAL_REPOSITORY);
  assert.equal(source.path, CANONICAL_PATH);
  assert.equal(source.commit, REAL_CANONICAL_COMMIT);
  assert.equal(source.recordCount, 130);

  assert.equal(manifest.candidateCount, 2);
  for (const candidate of manifest.candidates) {
    assert.equal(candidate.state, 'REFERENCE_ONLY');
    assert.equal('artifactId' in candidate, false);
    assert.equal('expectedSha256' in candidate, false);
    assert.equal('archivePath' in candidate, false);
  }
  assert.deepEqual(
    manifest.candidates.map((c) => c.canonicalId),
    ['TOBY_T1201_TheValidatorAwakening', 'TOBY_T1203_TheLanguageOfEndurance'],
  );
});