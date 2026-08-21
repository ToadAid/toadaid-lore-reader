import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readDesktopLoreStatus, shortCommit } from './desktop-status.mjs';

// Stage 2A-DESK1 §27 / §31 test #13: displayed generation + record count derive
// from the EXISTING generated provenance (LORE_SOURCE.json), not from desktop
// settings or invented values. This is display-only; validation stays in P2R2.

const VALID_COMMIT = '464933cecb6f508a980a66d37c8a7ef7add2f53d';

test('missing generated dir yields unavailable status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-status-'));
  try {
    const status = readDesktopLoreStatus(dir);
    assert.equal(status.available, false);
    assert.equal(shortCommit(status), 'unavailable');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('valid LORE_SOURCE.json drives generation + record count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-status-'));
  try {
    await writeFile(join(dir, 'LORE_SOURCE.json'), JSON.stringify({
      schemaVersion: '1.0.0',
      repository: 'ToadAid/toadaid.github.io',
      path: 'lore/data.json',
      commit: VALID_COMMIT,
      sourceDigest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      recordCount: 130,
      generatedAt: '2026-08-20T00:00:00.000Z',
    }));
    const status = readDesktopLoreStatus(dir);
    assert.equal(status.available, true);
    assert.equal(status.commit, VALID_COMMIT);
    assert.equal(status.recordCount, 130);
    assert.equal(status.generatedAt, '2026-08-20T00:00:00.000Z');
    assert.equal(shortCommit(status), '464933c');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('status never invents provenance for a missing commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-status-'));
  try {
    await writeFile(join(dir, 'LORE_SOURCE.json'), JSON.stringify({ recordCount: 5 }));
    const status = readDesktopLoreStatus(dir);
    assert.equal(status.available, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a corrupt LORE_SOURCE.json yields unavailable, never throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-status-'));
  try {
    await writeFile(join(dir, 'LORE_SOURCE.json'), '{ broken');
    const status = readDesktopLoreStatus(dir);
    assert.equal(status.available, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});