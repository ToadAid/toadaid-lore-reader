import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSettingsStore } from './settings-store.mjs';

// Stage 2A-DESK1 §13 / §31 test #4: folder selection persists ONLY
// canonicalRepoPath. No lore content, source bytes, provenance, tokens, etc.

test('settings store defaults to empty canonical repo path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-settings-'));
  try {
    const store = createSettingsStore(dir);
    assert.equal(store.getCanonicalRepoPath(), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setCanonicalRepoPath persists and reads back only that key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-settings-'));
  try {
    const store = createSettingsStore(dir);
    const returned = store.setCanonicalRepoPath('/home/tommy/toadaid.github.io');
    assert.equal(returned, '/home/tommy/toadaid.github.io');
    assert.equal(store.getCanonicalRepoPath(), '/home/tommy/toadaid.github.io');

    // The on-disk file contains ONLY canonicalRepoPath — no lore/bytes/tokens.
    const raw = JSON.parse(await readFile(join(dir, 'desktop-settings.json'), 'utf8'));
    assert.deepEqual(Object.keys(raw).sort(), ['canonicalRepoPath']);
    assert.equal(raw.canonicalRepoPath, '/home/tommy/toadaid.github.io');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('setCanonicalRepoPath replaces the prior value and adds no other keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-settings-'));
  try {
    const store = createSettingsStore(dir);
    store.setCanonicalRepoPath('/first/path');
    store.setCanonicalRepoPath('/second/path');
    assert.equal(store.getCanonicalRepoPath(), '/second/path');
    const raw = JSON.parse(await readFile(join(dir, 'desktop-settings.json'), 'utf8'));
    assert.deepEqual(Object.keys(raw).sort(), ['canonicalRepoPath']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a corrupt settings file falls back to empty, never throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-settings-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'desktop-settings.json'), '{ not valid json');
    const store = createSettingsStore(dir);
    assert.equal(store.getCanonicalRepoPath(), '');
    store.setCanonicalRepoPath('/ok/path');
    assert.equal(store.getCanonicalRepoPath(), '/ok/path');
  } finally { await rm(dir, { recursive: true, force: true }); }
});