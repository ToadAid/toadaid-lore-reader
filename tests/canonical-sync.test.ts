import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CANONICAL_REPOSITORY,
  CANONICAL_BRANCH,
  CANONICAL_PATH,
  FULL_SHA_RE,
} from '../src/lib/lore/provenance.ts';
import {
  resolveCanonicalMain,
  readCanonicalBytes,
  normalizeRemoteUrl,
  assertCanonicalRemote,
} from '../src/lib/lore/canonical-git-source.ts';
import { buildGenerationArtifacts, writeGenerationArtifacts } from '../scripts/import-canonical-lore.mjs';
import { syncCanonicalLore } from '../scripts/sync-canonical-lore.mjs';
import { loadArchiveCoverState, loadGeneratedArchive } from '../src/lib/lore/archive-cover-state.ts';
import { loadMediaReaderState } from '../src/lib/lore/media-reader-state.ts';

// ---------------------------------------------------------------------------
// Stage 2A-P2R2 — canonical-main source-following lore sync proofs.
//
// ONE AUTHORED SOURCE → SYNC → DERIVED READER. The operator supplies only the
// local canonical repository path; sync resolves canonical `main` to one exact
// frozen SHA, imports the exact Git-object bytes, validates, and records commit
// + digest automatically. No Reader-side commit/digest hardcode remains.
//
// All Git proofs use LOCAL fixture repositories (a bare remote + a clone whose
// origin URL is the canonical GitHub URL, with a local `insteadOf` rewrite so
// fetch is hermetic — NO network, NO real GitHub). This exercises the REAL
// production code path (assertCanonicalRemote sees the canonical URL; fetch is
// rewritten locally).
// ---------------------------------------------------------------------------

const REPO = resolve('.');
const CANONICAL_URL = 'https://github.com/ToadAid/toadaid.github.io';
const GENERATED_AT = '2026-08-20T00:00:00.000Z';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'P2R2 Test',
  GIT_AUTHOR_EMAIL: 'p2r2@test.local',
  GIT_COMMITTER_NAME: 'P2R2 Test',
  GIT_COMMITTER_EMAIL: 'p2r2@test.local',
  GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z',
};

function git(cwd: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV, input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function gitRaw(args: string[], input?: string): string {
  const result = spawnSync('git', args, { encoding: 'utf8', env: GIT_ENV, input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function digest(bytes: string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const dirs: string[] = [];
test.after?.(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** A hermetic canonical clone: a bare "remote" + a clone whose origin URL is the
 *  canonical GitHub URL, with a local `insteadOf` rewrite so fetches stay local.
 *  assertCanonicalRemote reads the raw configured canonical URL; fetch is
 *  rewritten to the bare repo. No network. */
interface Clone {
  clone: string;
  bare: string;
}
function makeCanonicalClone(): Clone {
  const bare = mkdtempSync(join(tmpdir(), 'p2r2-bare-'));
  dirs.push(bare);
  gitRaw(['init', '--bare', '-q', bare]);
  const clone = mkdtempSync(join(tmpdir(), 'p2r2-clone-'));
  dirs.push(clone);
  gitRaw(['clone', '-q', bare, clone]);
  // Point origin at the canonical GitHub URL (identity check sees this), and
  // rewrite that URL to the local bare repo for fetch (hermetic).
  git(clone, ['remote', 'set-url', 'origin', CANONICAL_URL]);
  git(clone, ['config', `url.${bare}.insteadOf`, CANONICAL_URL]);
  return { clone, bare };
}

/** Commit `loreJson` as lore/data.json on the clone and push to the bare remote
 *  so canonical `main` advances. Returns the new commit SHA. */
function commitLore(c: Clone, loreJson: string, message: string): string {
  mkdirSync(join(c.clone, 'lore'), { recursive: true });
  writeFileSync(join(c.clone, CANONICAL_PATH), loreJson);
  git(c.clone, ['add', CANONICAL_PATH]);
  git(c.clone, ['commit', '-q', '-m', message]);
  git(c.clone, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return git(c.clone, ['rev-parse', 'HEAD']);
}

/** Read lore/data.json from the exact Git object <sha>:lore/data.json. */
function objectBytes(c: Clone, sha: string): string {
  return git(c.clone, ['show', `${sha}:${CANONICAL_PATH}`]);
}

function lore(records: Array<Record<string, unknown>>): string {
  return JSON.stringify(records);
}

const fixtureA = lore([
  { id: 'TOBY_A', date: '2024-01-01', title: 'A', comment: 'c', original: 'o', url: '', img: 'https://toadaid.github.io/assets/lore/a.jpg', tags: 't' },
]);
const fixtureB = lore([
  { id: 'TOBY_B1', date: '2024-02-01', title: 'B1', comment: 'c', img: 'https://toadaid.github.io/assets/lore/b1.jpg' },
  { id: 'TOBY_B2', date: '2024-02-02', title: 'B2', comment: 'c' },
]);
const dupeFixture = lore([
  { id: 'TOBY_D', date: '2024-03-01', title: 'D1', comment: 'c' },
  { id: 'TOBY_D', date: '2024-03-02', title: 'D2', comment: 'c' },
]);

async function syncInto(c: Clone, output: string) {
  return syncCanonicalLore({ canonicalRepo: c.clone, output, generatedAt: GENERATED_AT });
}

function runSyncCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [resolve(REPO, 'scripts/sync-canonical-lore.mjs'), ...args], {
    encoding: 'utf8',
    cwd: REPO,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// 1-3. Permanent canonical identity is architecture constants.
// ---------------------------------------------------------------------------

test('1. canonical repository identity is permanently fixed', () => {
  assert.equal(CANONICAL_REPOSITORY, 'ToadAid/toadaid.github.io');
});

test('2. canonical source path is permanently fixed', () => {
  assert.equal(CANONICAL_PATH, 'lore/data.json');
});

test('3. canonical branch is permanently main', () => {
  assert.equal(CANONICAL_BRANCH, 'main');
});

// ---------------------------------------------------------------------------
// 4-7. Sync resolves canonical main → exact frozen SHA → exact Git-object bytes.
// ---------------------------------------------------------------------------

test('4. sync resolves canonical main to an exact full 40-char SHA', () => {
  const c = makeCanonicalClone();
  const commitA = commitLore(c, fixtureA, 'add lore A');
  const sha = resolveCanonicalMain(c.clone);
  assert.equal(FULL_SHA_RE.test(sha), true);
  assert.equal(sha, commitA);
  assert.equal(sha, git(c.bare, ['rev-parse', 'main']));
});

test('5. the resolved SHA is frozen and recorded as the generation commit', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  assert.equal(result.ok, true);
  // The frozen resolved SHA is the one recorded in provenance (no moving-branch
  // follow during the generation).
  assert.equal(result.provenance.commit, result.resolvedCommit);
});

test('6. source bytes come from the exact resolved commit Git object', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  // Independently read the Git object at the resolved SHA and compare digests.
  const bytes = objectBytes(c, result.resolvedCommit);
  assert.equal(result.provenance.sourceDigest, digest(bytes));
  assert.equal(result.provenance.sourceDigest, digest(fixtureA));
});

test('7. a dirty canonical working tree cannot affect sync', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  // Dirty the working tree with B WITHOUT committing. Sync must read the frozen
  // committed object A, not the dirty tree B.
  writeFileSync(join(c.clone, CANONICAL_PATH), fixtureB);
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  assert.equal(result.ok, true);
  assert.equal(result.provenance.sourceDigest, digest(fixtureA));
  assert.notEqual(result.provenance.sourceDigest, digest(fixtureB));
});

// ---------------------------------------------------------------------------
// 8-10. Advancing main A → B advances generated provenance without Reader
// code changes; digest + record count are recomputed automatically.
// ---------------------------------------------------------------------------

test('8. advancing canonical main A → B advances the Reader generation with no Reader code change', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const a = await syncInto(c, out);
  assert.equal(a.ok, true);
  assert.equal(loadArchiveCoverState(out).status, 'verified');

  // Advance canonical main to B and sync again — same command, no Reader edit.
  commitLore(c, fixtureB, 'change lore B');
  const b = await syncInto(c, out);
  assert.equal(b.ok, true);

  assert.notEqual(a.provenance.commit, b.provenance.commit);
  assert.notEqual(a.provenance.sourceDigest, b.provenance.sourceDigest);
  assert.equal(a.provenance.repository, b.provenance.repository);
  assert.equal(a.provenance.path, b.provenance.path);
  // The loader accepts the new generation B (no hardcoded generation pin).
  const state = loadArchiveCoverState(out);
  assert.equal(state.status, 'verified');
  assert.equal(state.canonicalCommit, b.provenance.commit);
});

test('9. the source digest is automatically recalculated per generation', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const a = await syncInto(c, out);
  commitLore(c, fixtureB, 'change lore B');
  const b = await syncInto(c, out);
  assert.equal(a.provenance.sourceDigest, digest(fixtureA));
  assert.equal(b.provenance.sourceDigest, digest(fixtureB));
  assert.notEqual(a.provenance.sourceDigest, b.provenance.sourceDigest);
});

test('10. the record count is automatically recalculated per generation', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const a = await syncInto(c, out);
  assert.equal(a.provenance.recordCount, 1);
  commitLore(c, fixtureB, 'change lore B');
  const b = await syncInto(c, out);
  assert.equal(b.provenance.recordCount, 2);
});

// ---------------------------------------------------------------------------
// 11-15. Loader validates by identity + self-consistency, not a hardcoded gen.
// ---------------------------------------------------------------------------

test('11. loader accepts a valid generation A', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  await syncInto(c, out);
  const state = loadArchiveCoverState(out);
  assert.equal(state.status, 'verified');
  assert.equal(state.repository, CANONICAL_REPOSITORY);
  assert.equal(state.path, CANONICAL_PATH);
});

test('12. loader accepts a valid generation B without any hardcoded Reader change', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureB, 'add lore B');
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  const state = loadArchiveCoverState(out);
  assert.equal(state.status, 'verified');
  assert.equal(state.canonicalCommit, result.provenance.commit);
  assert.equal(state.sourceDigest, result.provenance.sourceDigest);
  assert.equal(state.recordCount, 2);
});

function craftGenerationDir(commit: string, sourceDigest: string, recordCount: number, recordCountActual: number) {
  const dir = tmpDir('p2r2-craft-');
  const provenance = { schemaVersion: '1.0.0', repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit, sourceDigest, recordCount, generatedAt: GENERATED_AT };
  const records = [];
  for (let i = 0; i < recordCountActual; i++) {
    const id = `TOBY_C${i}`;
    records.push({ canonicalId: id, canonical: { id, date: '2024-01-01', title: `C${i}`, comment: 'c' }, chronology: { archiveChronologyMarker: '2024-01-01', sortKey: `2024-01-01 ${id}`, hasVerifiedPublicationTimestamp: false } });
  }
  const snapshot = { schemaVersion: '1.0.0', provenance: { ...provenance }, records };
  writeFileSync(join(dir, 'LORE_SOURCE.json'), JSON.stringify(provenance));
  writeFileSync(join(dir, 'reader-snapshot.json'), JSON.stringify(snapshot));
  return dir;
}

test('13. loader refuses malformed commit provenance', () => {
  const dir = craftGenerationDir('not-a-sha', 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', 1, 1);
  assert.throws(() => loadGeneratedArchive(dir), /commit provenance is malformed/);
});

test('14. loader refuses malformed source-digest provenance', () => {
  const dir = craftGenerationDir('1a2b3c4d5e6f7081920304050607080910111213', 'not-a-digest', 1, 1);
  assert.throws(() => loadGeneratedArchive(dir), /source digest provenance is malformed/);
});

test('15. loader refuses repository/path substitution', () => {
  const dir = tmpDir('p2r2-craft-');
  const provenance = { schemaVersion: '1.0.0', repository: 'other/archive', path: CANONICAL_PATH, commit: '1a2b3c4d5e6f7081920304050607080910111213', sourceDigest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', recordCount: 1, generatedAt: GENERATED_AT };
  const snapshot = { schemaVersion: '1.0.0', provenance: { ...provenance }, records: [{ canonicalId: 'TOBY_X', canonical: { id: 'TOBY_X', date: '2024-01-01', title: 'X', comment: 'c' }, chronology: { archiveChronologyMarker: '2024-01-01', sortKey: '2024-01-01 TOBY_X', hasVerifiedPublicationTimestamp: false } }] };
  writeFileSync(join(dir, 'LORE_SOURCE.json'), JSON.stringify(provenance));
  writeFileSync(join(dir, 'reader-snapshot.json'), JSON.stringify(snapshot));
  assert.throws(() => loadGeneratedArchive(dir), /repository is not canonical/);

  const dir2 = tmpDir('p2r2-craft-');
  const provenance2 = { ...provenance, repository: CANONICAL_REPOSITORY, path: 'other.json' };
  const snapshot2 = { ...snapshot, provenance: { ...provenance2 } };
  writeFileSync(join(dir2, 'LORE_SOURCE.json'), JSON.stringify(provenance2));
  writeFileSync(join(dir2, 'reader-snapshot.json'), JSON.stringify(snapshot2));
  assert.throws(() => loadGeneratedArchive(dir2), /path is not canonical/);
});

// ---------------------------------------------------------------------------
// 16-18. Invalid source fails closed; prior generation preserved; mixed-gen
// manifests fail closed.
// ---------------------------------------------------------------------------

test('16. duplicate canonical IDs refuse sync', async () => {
  const c = makeCanonicalClone();
  commitLore(c, dupeFixture, 'add dupe lore');
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  assert.equal(result.ok, false);
  assert.match(result.reason, /duplicate canonical id/);
  assert.equal(result.preserved, true);
  // Nothing was published.
  assert.equal(existsSync(join(out, 'reader-snapshot.json')), false);
});

test('17. a failed candidate generation leaves the prior valid generation unchanged', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const a = await syncInto(c, out);
  assert.equal(a.ok, true);
  const beforeCommit = a.provenance.commit;
  const beforeDigest = a.provenance.sourceDigest;

  // Now canonical main becomes invalid (duplicate IDs). Sync must refuse and
  // the prior generation A must remain intact.
  commitLore(c, dupeFixture, 'add dupe lore');
  const refused = await syncInto(c, out);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /duplicate canonical id/);

  const state = loadArchiveCoverState(out);
  assert.equal(state.status, 'verified');
  assert.equal(state.canonicalCommit, beforeCommit);
  assert.equal(state.sourceDigest, beforeDigest);
});

test('17a. failure after one live replacement reports publication unknown and not preserved', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const a = await syncInto(c, out);
  assert.equal(a.ok, true);

  const before = new Map(
    ['reader-snapshot.json', 'LORE_SOURCE.json', 'legacy-media-candidates.json', 'media-interpretation.json']
      .map((file) => [file, readFileSync(join(out, file))]),
  );
  commitLore(c, fixtureB, 'change lore B');
  let renameCalls = 0;
  const failed = await syncCanonicalLore(
    { canonicalRepo: c.clone, output: out, generatedAt: GENERATED_AT },
    {
      renameFile: async (source: string, destination: string) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new Error('injected publish failure');
        await rename(source, destination);
      },
    },
  );

  assert.equal(renameCalls, 2);
  assert.equal(failed.ok, false);
  assert.equal(failed.publicationState, 'failed_unknown');
  assert.equal(failed.publishedArtifactCount, 1);
  assert.equal(failed.preserved, false);
  assert.match(failed.reason, /PUBLISH_PHASE_FAILED_AFTER_1_REPLACEMENTS/);
  assert.notDeepEqual(readFileSync(join(out, 'reader-snapshot.json')), before.get('reader-snapshot.json'));
  for (const file of ['LORE_SOURCE.json', 'legacy-media-candidates.json', 'media-interpretation.json']) {
    assert.deepEqual(readFileSync(join(out, file)), before.get(file));
  }
  assert.throws(() => loadGeneratedArchive(out), /snapshot provenance does not match LORE_SOURCE/);
});

test('18. mixed-generation derived manifests fail closed', async () => {
  // Build two complete valid generations in memory, then write generation A's
  // snapshot + LORE_SOURCE but generation B's media-interpretation manifest into
  // one generated directory. The media reader must refuse (fail closed) because
  // the media manifest is not the same generation as the snapshot.
  const bytesA = JSON.stringify([{ id: 'TOBY_A', date: '2024-01-01', title: 'A', comment: 'c', img: 'https://toadaid.github.io/assets/lore/a.jpg' }]);
  const bytesB = JSON.stringify([{ id: 'TOBY_B', date: '2024-02-01', title: 'B', comment: 'c', img: 'https://toadaid.github.io/assets/lore/b.jpg' }]);
  const genA = buildGenerationArtifacts(bytesA, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: 'a'.repeat(40) }, GENERATED_AT);
  const genB = buildGenerationArtifacts(bytesB, { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: 'b'.repeat(40) }, GENERATED_AT);

  const dir = tmpDir('p2r2-mix-');
  await writeFile(join(dir, 'reader-snapshot.json'), `${JSON.stringify(genA.snapshot, null, 2)}\n`);
  await writeFile(join(dir, 'LORE_SOURCE.json'), `${JSON.stringify(genA.source, null, 2)}\n`);
  await writeFile(join(dir, 'legacy-media-candidates.json'), `${JSON.stringify(genA.legacyMediaCandidates, null, 2)}\n`);
  // The mismatch: media-interpretation is generation B, snapshot is generation A.
  await writeFile(join(dir, 'media-interpretation.json'), `${JSON.stringify(genB.mediaInterpretation, null, 2)}\n`);

  assert.throws(() => loadMediaReaderState(dir), /refused/);
  // And the cover loader alone still accepts generation A (it does not read the
  // media manifest); the mixed-generation law is enforced by the media reader.
  assert.equal(loadArchiveCoverState(dir).status, 'verified');
});

// ---------------------------------------------------------------------------
// 19-21. Ordinary sync needs no --commit / --digest / source bytes; those are
// refused (the operator cannot hand-pin a generation).
// ---------------------------------------------------------------------------

test('19. ordinary sync requires no --commit (only --canonical-repo)', () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const r = runSyncCli(['--canonical-repo', c.clone, '--output', out, '--generated-at', GENERATED_AT]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CANONICAL_SYNC_OK/);
  assert.match(r.stdout, /resolved_commit: [0-9a-f]{40}/);
  assert.equal(existsSync(join(out, 'reader-snapshot.json')), true);
});

test('20. sync does not accept a caller-supplied --commit or --digest', () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const rCommit = runSyncCli(['--canonical-repo', c.clone, '--output', out, '--commit', '1a2b3c4d5e6f7081920304050607080910111213']);
  assert.equal(rCommit.status, 1);
  assert.match(rCommit.stderr, /--commit is not accepted/);
  assert.equal(existsSync(join(out, 'reader-snapshot.json')), false);

  const rDigest = runSyncCli(['--canonical-repo', c.clone, '--output', out, '--digest', 'sha256:abc']);
  assert.equal(rDigest.status, 1);
  assert.match(rDigest.stderr, /--digest is not accepted/);
});

test('21. sync does not accept caller-supplied lore bytes (--source)', () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  const out = tmpDir('p2r2-out-');
  const r = runSyncCli(['--canonical-repo', c.clone, '--output', out, '--source', '/tmp/x.json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--source is not accepted/);
  assert.equal(existsSync(join(out, 'reader-snapshot.json')), false);
});

// ---------------------------------------------------------------------------
// 22. Sync does not mutate canonical working-tree files.
// ---------------------------------------------------------------------------

test('22. sync does not mutate canonical working-tree files', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  // Leave a deliberate dirty working tree; sync must leave it byte-identical.
  writeFileSync(join(c.clone, CANONICAL_PATH), fixtureB);
  const before = readFileSync(join(c.clone, CANONICAL_PATH), 'utf8');
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  assert.equal(result.ok, true);
  const after = readFileSync(join(c.clone, CANONICAL_PATH), 'utf8');
  assert.equal(after, before);
  assert.equal(after, fixtureB);
});

// ---------------------------------------------------------------------------
// 23-24. No Reader runtime network fetch; no second canonical-data copy.
// ---------------------------------------------------------------------------

test('23. no Reader runtime network fetch of the canonical lore source is introduced', () => {
  // Reader pages remain static + deterministic from the last synced generation.
  // No page fetches the canonical lore URL at browser runtime.
  const pages = [
    resolve(REPO, 'src/pages/record/[canonicalId].astro'),
    resolve(REPO, 'src/pages/chronicle/index.astro'),
    resolve(REPO, 'src/pages/bookmarks/index.astro'),
  ];
  for (const page of pages) {
    const src = readFileSync(page, 'utf8');
    assert.equal(src.includes('toadaid.github.io/lore/data.json'), false, `${page} must not fetch the canonical lore source at runtime`);
  }
});

test('24. no second canonical-data copy is authored (generated/ is disposable, gitignored)', () => {
  // generated/** is derived operator material, never a second authored source.
  const gitignore = readFileSync(resolve(REPO, '.gitignore'), 'utf8');
  assert.match(gitignore, /generated\/\*/);
  // The only tracked file under generated/ is the .gitkeep placeholder — no
  // committed lore data copy lives there.
  const tracked = gitRaw(['-C', REPO, 'ls-files', 'generated/']).split('\n').filter(Boolean);
  assert.deepEqual(tracked, ['generated/.gitkeep']);
  // No tracked Reader file is a lore data.json copy.
  const allTracked = gitRaw(['-C', REPO, 'ls-files']).split('\n').filter(Boolean);
  const loreCopies = allTracked.filter((f) => f.endsWith('data.json'));
  assert.deepEqual(loreCopies, []);
});

// ---------------------------------------------------------------------------
// Canonical-remote identity verification (used by sync, hermetic).
// ---------------------------------------------------------------------------

test('normalizeRemoteUrl retains the canonical GitHub host for governed HTTPS and SSH forms', () => {
  const identity = 'github.com/ToadAid/toadaid.github.io';
  assert.equal(normalizeRemoteUrl('https://github.com/ToadAid/toadaid.github.io'), identity);
  assert.equal(normalizeRemoteUrl('https://github.com/ToadAid/toadaid.github.io.git'), identity);
  assert.equal(normalizeRemoteUrl('git@github.com:ToadAid/toadaid.github.io.git'), identity);
  assert.equal(normalizeRemoteUrl('ssh://git@github.com/ToadAid/toadaid.github.io.git'), identity);
});

test('assertCanonicalRemote accepts only canonical GitHub forms and rejects foreign identity or host', () => {
  const c = makeCanonicalClone();
  for (const canonical of [
    'https://github.com/ToadAid/toadaid.github.io',
    'https://github.com/ToadAid/toadaid.github.io.git',
    'git@github.com:ToadAid/toadaid.github.io.git',
    'ssh://git@github.com/ToadAid/toadaid.github.io.git',
  ]) {
    git(c.clone, ['remote', 'set-url', 'origin', canonical]);
    assert.doesNotThrow(() => assertCanonicalRemote(c.clone));
  }

  const foreign = makeCanonicalClone();
  git(foreign.clone, ['remote', 'set-url', 'origin', 'https://github.com/other/repo.git']);
  assert.throws(() => assertCanonicalRemote(foreign.clone), /CANONICAL_REMOTE_NOT_CANONICAL/);

  git(foreign.clone, ['remote', 'set-url', 'origin', 'https://evil.example/ToadAid/toadaid.github.io.git']);
  assert.throws(() => assertCanonicalRemote(foreign.clone), /CANONICAL_REMOTE_NOT_CANONICAL/);
});

test('sync against a non-canonical remote is refused', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  // Retarget origin at a foreign repository.
  git(c.clone, ['remote', 'set-url', 'origin', 'https://github.com/other/repo.git']);
  // Remove the insteadOf rewrite so fetch is not redirected (the refusal is the
  // remote identity check, which happens before fetch).
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  assert.equal(result.ok, false);
  assert.match(result.reason, /CANONICAL_REMOTE_NOT_CANONICAL/);
  assert.equal(existsSync(join(out, 'reader-snapshot.json')), false);
});

test('sync refuses a foreign host carrying the exact canonical owner/repository path', async () => {
  const c = makeCanonicalClone();
  commitLore(c, fixtureA, 'add lore A');
  git(c.clone, ['remote', 'set-url', 'origin', 'https://evil.example/ToadAid/toadaid.github.io.git']);
  const out = tmpDir('p2r2-out-');
  const result = await syncInto(c, out);
  assert.equal(result.ok, false);
  assert.match(result.reason, /CANONICAL_REMOTE_NOT_CANONICAL/);
  assert.equal(result.publicationState, 'not_started');
  assert.equal(result.preserved, true);
  assert.equal(existsSync(join(out, 'reader-snapshot.json')), false);
});

// ---------------------------------------------------------------------------
// §22 successful fixture advancement proof (explicit, with the CLI surface).
// ---------------------------------------------------------------------------

test('fixture A → B advancement: both generations succeed via the same sync command', async () => {
  const c = makeCanonicalClone();
  const out = tmpDir('p2r2-out-');

  const commitA = commitLore(c, fixtureA, 'add lore A');
  const a = await syncInto(c, out);
  assert.equal(a.ok, true);
  assert.equal(a.provenance.commit, commitA);
  assert.equal(a.provenance.sourceDigest, digest(fixtureA));

  const commitB = commitLore(c, fixtureB, 'change lore B');
  const b = await syncInto(c, out);
  assert.equal(b.ok, true);
  assert.equal(b.provenance.commit, commitB);
  assert.equal(b.provenance.sourceDigest, digest(fixtureB));

  assert.notEqual(commitA, commitB);
  assert.notEqual(a.provenance.sourceDigest, b.provenance.sourceDigest);
  // Reader source was not edited between generations (the test never touches it).
  assert.equal(a.provenance.repository, b.provenance.repository);
  assert.equal(a.provenance.path, b.provenance.path);
  // The live generated state is now generation B.
  const state = loadArchiveCoverState(out);
  assert.equal(state.status, 'verified');
  assert.equal(state.canonicalCommit, commitB);
});
