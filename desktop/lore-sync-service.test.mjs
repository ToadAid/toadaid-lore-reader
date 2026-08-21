import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDesktopLoreSyncService } from './lore-sync-service.mjs';

// Stage 2A-DESK1 §15/§16/§30/§31. The service is the testable orchestration seam:
// sync/build/settings/reload are all injected, so no real sync or build runs and
// no Electron session is launched.

function fakeStore(path = '') {
  let p = path;
  return {
    getCanonicalRepoPath: () => p,
    setCanonicalRepoPath: (v) => { p = v; return p; },
  };
}

function makeService({ path = '/home/tommy/toadaid.github.io', sync, build, reload, generatedDir } = {}) {
  const calls = { sync: 0, build: 0, reload: 0, syncArgs: [] };
  const syncImpl = sync || (async (args) => {
    calls.sync += 1; calls.syncArgs.push(args);
    return { ok: true, commit: 'abc1234', recordCount: 130, generatedAt: '2026-08-20T00:00:00.000Z' };
  });
  const buildImpl = build || (async () => { calls.build += 1; return { ok: true }; });
  const reloadImpl = reload || (() => { calls.reload += 1; });
  const store = fakeStore(path);
  const service = createDesktopLoreSyncService({
    repoRoot: '/repo',
    settingsStore: store,
    generatedDir: generatedDir ?? '/repo/generated',
    sync: syncImpl,
    build: buildImpl,
    reload: reloadImpl,
    now: () => '2026-08-20T00:00:00.000Z',
  });
  return { service, calls, store };
}

test('#3 no canonical path configured → refused locally without invoking sync', async () => {
  const { service, calls } = makeService({ path: '' });
  const result = await service.syncLore();
  assert.equal(result.kind, 'no-config');
  assert.equal(result.ok, false);
  assert.equal(calls.sync, 0, 'sync must not be invoked when no repo is configured');
  assert.equal(calls.build, 0);
});

test('#5 sync click invokes exactly one sync with the configured repo', async () => {
  const { service, calls } = makeService();
  await service.syncLore();
  assert.equal(calls.sync, 1);
  assert.deepEqual(calls.syncArgs[0], { canonicalRepo: '/home/tommy/toadaid.github.io', repoRoot: '/repo', output: '/repo/generated' });
});

test('#6 second click while active does not queue another operation', async () => {
  let resolveSync;
  let syncCalls = 0;
  const sync = () => new Promise((r) => { syncCalls += 1; resolveSync = r; });
  const { service } = makeService({ sync });
  const first = service.syncLore();
  const second = service.syncLore(); // while first is pending
  const secondResult = await second;
  assert.equal(secondResult.kind, 'busy');
  assert.equal(secondResult.ok, false);
  assert.equal(syncCalls, 1, 'only one sync in flight; second was not queued');
  resolveSync({ ok: true, commit: 'abc1234', recordCount: 130, generatedAt: '2026-08-20T00:00:00.000Z' });
  const firstResult = await first;
  assert.equal(firstResult.kind, 'success');
  assert.equal(syncCalls, 1);
});

test('#7/#8/#23 sync refusal does not invoke build, exposes reason, leaves Reader usable', async () => {
  const reloadCalls = { reload: 0 };
  const reload = () => { reloadCalls.reload += 1; };
  const sync = async () => ({ ok: false, reason: 'Duplicate canonical id: TOBY_1756312669192' });
  const { service, calls } = makeService({ sync, reload });
  const result = await service.syncLore();
  assert.equal(result.kind, 'refused');
  assert.equal(result.ok, false);
  assert.match(result.reason, /Duplicate canonical id/);
  assert.equal(calls.build, 0, 'build must not run after a sync refusal');
  assert.equal(reloadCalls.reload, 0, 'Reader is not reloaded on refusal — stays usable');
});

test('#9 sync success invokes build exactly once', async () => {
  const { service, calls } = makeService();
  await service.syncLore();
  assert.equal(calls.build, 1);
});

test('#10 build success emits reload exactly once', async () => {
  const { service, calls } = makeService();
  const result = await service.syncLore();
  assert.equal(result.kind, 'success');
  assert.equal(calls.reload, 1, 'reload fires exactly once after success');
});

test('#11/#12 build failure does not claim success, does not retry, does not reload', async () => {
  let buildCalls = 0;
  const reloadCalls = { reload: 0 };
  const build = async () => { buildCalls += 1; return { ok: false, reason: 'astro build exited 1' }; };
  const reload = () => { reloadCalls.reload += 1; };
  const { service } = makeService({ build, reload });
  const result = await service.syncLore();
  assert.equal(result.kind, 'build-failed');
  assert.equal(result.ok, false);
  assert.equal(result.commit, 'abc1234', 'synced generation is reported even though build failed');
  assert.match(result.reason, /build/);
  assert.equal(buildCalls, 1, 'no retry on build failure');
  assert.equal(reloadCalls.reload, 0, 'no reload on build failure — loaded Reader kept intact');
});

test('#13 getStatus derives generation + record count from generated provenance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desk-svc-status-'));
  try {
    await writeFile(join(dir, 'LORE_SOURCE.json'), JSON.stringify({
      schemaVersion: '1.0.0', repository: 'ToadAid/toadaid.github.io', path: 'lore/data.json',
      commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
      sourceDigest: 'sha256:8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f984',
      recordCount: 130, generatedAt: '2026-08-19T00:00:00.000Z',
    }));
    const { service } = makeService({ generatedDir: dir });
    const status = service.getStatus();
    assert.equal(status.available, true);
    assert.equal(status.commit, '464933cecb6f508a980a66d37c8a7ef7add2f53d');
    assert.equal(status.recordCount, 130);
    assert.equal(status.generation, '464933c');
    assert.equal(status.lastSyncedAt, '2026-08-19T00:00:00.000Z', 'startup seeds last synced from existing generation (§41)');
    assert.equal(status.inProgress, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('success sets lastSyncedAt and a subsequent status reflects it', async () => {
  const { service } = makeService();
  await service.syncLore();
  const status = service.getStatus();
  assert.equal(status.lastSyncedAt, '2026-08-20T00:00:00.000Z');
});