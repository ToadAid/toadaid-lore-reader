import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadArchiveCoverState } from '../src/lib/lore/archive-cover-state.ts';

const canonical = {
  repository: 'ToadAid/toadaid.github.io',
  path: 'lore/data.json',
  commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
  sourceDigest: 'sha256:8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f984',
  recordCount: 2,
  generatedAt: '2026-08-19T00:00:00.000Z',
};

async function withGenerated(mutator: (provenance: Record<string, unknown>, snapshot: Record<string, unknown>) => void = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'toadaid-cover-state-'));
  const provenance = { schemaVersion: '1.0.0', ...canonical };
  const snapshot = {
    schemaVersion: '1.0.0',
    provenance: { ...provenance },
    records: [
      { canonicalId: 'TOBY_A', canonical: { id: 'TOBY_A', date: '2024-01-01', title: 'A', comment: 'A' }, chronology: { archiveChronologyMarker: '2024-01-01', sortKey: '2024-01-01\u0000TOBY_A', hasVerifiedPublicationTimestamp: false } },
      { canonicalId: 'TOBY_B', canonical: { id: 'TOBY_B', date: '2024-01-01', title: 'B', comment: 'B' }, chronology: { archiveChronologyMarker: '2024-01-01', sortKey: '2024-01-01\u0000TOBY_B', hasVerifiedPublicationTimestamp: false } },
    ],
  };
  mutator(provenance, snapshot);
  await writeFile(join(directory, 'LORE_SOURCE.json'), JSON.stringify(provenance));
  await writeFile(join(directory, 'reader-snapshot.json'), JSON.stringify(snapshot));
  return { directory, close: () => rm(directory, { recursive: true, force: true }) };
}

test('missing generated artifacts produce an unavailable state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'toadaid-cover-empty-'));
  try { assert.deepEqual(loadArchiveCoverState(directory), { status: 'unavailable' }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('valid generated artifacts produce verified state from provenance', async () => {
  const fixture = await withGenerated();
  try {
    assert.deepEqual(loadArchiveCoverState(fixture.directory), {
      status: 'verified', recordCount: 2, canonicalCommit: canonical.commit,
      repository: canonical.repository, path: canonical.path, sourceDigest: canonical.sourceDigest,
    });
  } finally { await fixture.close(); }
});

for (const [name, mutate] of [
  ['wrong repository', (p: Record<string, unknown>) => { p.repository = 'other/archive'; }],
  ['wrong source path', (p: Record<string, unknown>) => { p.path = 'other.json'; }],
  // Stage 2A-P2R2: the loader no longer hardcodes a generation commit/digest.
  // A DIFFERENT valid generation is accepted (proven below); only MALFORMED
  // provenance form is refused. These cases use invalid forms, not merely
  // different valid values.
  ['malformed canonical commit', (p: Record<string, unknown>) => { p.commit = 'not-a-sha'; }],
  ['malformed source digest', (p: Record<string, unknown>) => { p.sourceDigest = 'not-a-digest'; }],
  ['snapshot/provenance count mismatch', (_p: Record<string, unknown>, s: Record<string, unknown>) => { s.records = []; }],
  ['duplicate snapshot canonical IDs', (_p: Record<string, unknown>, s: Record<string, unknown>) => { (s.records as Array<Record<string, unknown>>)[1].canonicalId = 'TOBY_A'; }],
] as const) {
  test(`${name} is refused`, async () => {
    const fixture = await withGenerated(mutate);
    try { assert.throws(() => loadArchiveCoverState(fixture.directory), /Generated archive state refused/); }
    finally { await fixture.close(); }
  });
}

test('a different valid generation is accepted (no hardcoded commit/digest pin)', async () => {
  // Stage 2A-P2R2 §14: the loader validates by identity + self-consistency, not
  // by one hardcoded generation. A generation with a different valid commit +
  // digest — kept self-consistent (snapshot provenance == LORE_SOURCE, count
  // match, unique IDs) — must be accepted, proving no Reader-side commit/digest
  // hardcode remains.
  const nextCommit = '1a2b3c4d5e6f7081920304050607080910111213';
  const nextDigest = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const fixture = await withGenerated((p, s) => {
    p.commit = nextCommit;
    p.sourceDigest = nextDigest;
    s.provenance.commit = nextCommit;
    s.provenance.sourceDigest = nextDigest;
  });
  try {
    const state = loadArchiveCoverState(fixture.directory);
    assert.equal(state.status, 'verified');
    assert.equal(state.canonicalCommit, nextCommit);
    assert.equal(state.sourceDigest, nextDigest);
  } finally { await fixture.close(); }
});
