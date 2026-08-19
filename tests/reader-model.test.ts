import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedRecords, recordRoute } from '../src/lib/lore/reader-model.ts';

const record = (id: string, date: string, title = id, original?: string, url?: string) => ({ canonicalId: id, canonical: { id, date, title, comment: 'comment', ...(original ? { original } : {}), ...(url ? { url } : {}) }, chronology: { archiveChronologyMarker: date, sortKey: `${date}\u0000${id}`, hasVerifiedPublicationTimestamp: false as const } });

test('chronicle ordering and routes preserve canonical identity', () => {
  const ordered = orderedRecords([record('TOBY_B', '2024-01-01'), record('TOBY_A', '2024-01-01'), record('TOBY_C', '2023-12-31')]);
  assert.deepEqual(ordered.map((entry) => entry.canonicalId), ['TOBY_C', 'TOBY_A', 'TOBY_B']);
  assert.equal(recordRoute('TOBY_A'), '/record/TOBY_A/');
});
test('chapter source variation remains structural', () => {
  const full = record('TOBY_FULL', '2024-01-01', 'Full', 'original', 'https://example.test');
  const sparse = record('TOBY_SPARSE', '2024-01-02');
  assert.equal(full.canonical.original, 'original');
  assert.equal(full.canonical.url, 'https://example.test');
  assert.equal(sparse.canonical.original, undefined);
  assert.equal(sparse.canonical.url, undefined);
});
