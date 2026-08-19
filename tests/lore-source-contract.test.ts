import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot } from '../scripts/import-canonical-lore.mjs';

const provenance = {
  repository: 'ToadAid/toadaid.github.io',
  path: 'lore/data.json',
  commit: '041c2ea6fda8284f61fb35c7101d083623d235ba',
};
const generatedAt = '2026-08-19T00:00:00.000Z';
const shaped = JSON.stringify([
  { id: 'TOBY_B', date: '2024-03-17', title: 'B', original: 'primary source', comment: 'commentary', url: '', img: '', tags: '' },
  { id: 'TOBY_A', date: '2024-03-17', title: 'A', comment: 'commentary only' },
]);
function build(source = shaped, p = provenance) { return buildSnapshot(source, p, generatedAt); }

test('valid canonical-shaped source is accepted and remains derived', () => {
  const result = build();
  assert.equal(result.source.recordCount, 2);
  assert.equal(result.snapshot.records[0].canonicalId, 'TOBY_A');
  assert.equal(result.snapshot.records[0].canonical.id, 'TOBY_A');
  assert.notEqual(result.snapshot.records[0].canonical, JSON.parse(shaped)[1]);
});
test('malformed top-level source is refused', () => assert.throws(() => build('{}'), /top-level/));
test('duplicate canonical IDs are refused', () => assert.throws(() => build(JSON.stringify([{ id: 'x', date: 'd', title: 'a', comment: 'c' }, { id: 'x', date: 'd', title: 'b', comment: 'c' }])), /duplicate/));
test('missing canonical identity is refused', () => assert.throws(() => build(JSON.stringify([{ date: 'd', title: 'a', comment: 'c' }])), /usable id/));
test('original and comment remain structurally distinct', () => {
  const record = build().snapshot.records[1].canonical;
  assert.equal(record.original, 'primary source');
  assert.equal(record.comment, 'commentary');
  assert.notEqual(record.original, record.comment);
});
test('chronology and same-date tie-breaker are deterministic', () => {
  const first = build().snapshot.records.map((record) => record.canonicalId);
  const second = build(JSON.stringify(JSON.parse(shaped).reverse())).snapshot.records.map((record) => record.canonicalId);
  assert.deepEqual(first, ['TOBY_A', 'TOBY_B']);
  assert.deepEqual(second, first);
});
test('chronology marker does not become publication claim', () => {
  const chronology = build().snapshot.records[0].chronology;
  assert.equal(chronology.archiveChronologyMarker, '2024-03-17');
  assert.equal(chronology.hasVerifiedPublicationTimestamp, false);
  assert.equal('publishedAt' in chronology, false);
});
test('exact provenance binding is retained and invalid provenance fails closed', () => {
  const result = build();
  assert.deepEqual({ repository: result.source.repository, path: result.source.path, commit: result.source.commit }, provenance);
  assert.throws(() => build(shaped, { ...provenance, commit: '0000000000000000000000000000000000000000' }), /not bound/);
});

