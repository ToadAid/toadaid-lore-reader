import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import overlay from './desktop-overlay.cjs';

// Stage 2A-DESK1 §9/§10/§11 / §31 tests #1/#2/#18/#19.

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PAGES_DIR = join(REPO_ROOT, 'src', 'pages');

async function listAstroFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listAstroFiles(full));
    else if (entry.name.endsWith('.astro') || entry.name.endsWith('.ts') || entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('#1 the public/static Reader is never authored with a Sync Lore control', async () => {
  const files = await listAstroFiles(PAGES_DIR);
  assert.ok(files.length > 0, 'expected Reader page sources to exist');
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /Sync Lore/, `${file} must not author a Sync Lore control`);
    assert.doesNotMatch(text, /toadaidDesktop/, `${file} must not reference the desktop bridge`);
    assert.doesNotMatch(text, /desktop:get-/, `${file} must not reference desktop IPC channels`);
  }
});

test('#2 the desktop overlay exposes a visible Sync Lore control', () => {
  const html = overlay.buildDesktopOverlayHTML({ available: true, commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d', recordCount: 130, lastSyncedAt: '2026-08-20T00:00:00.000Z', inProgress: false });
  assert.match(html, /Sync Lore/);
  assert.match(html, /Last synced:/);
  assert.match(html, /Generation:/);
  assert.match(html, /464933c/);
  assert.match(html, /Records:/);
});

test('#2 overlay shows Never/unavailable when no generation exists', () => {
  const html = overlay.buildDesktopOverlayHTML({ available: false, lastSyncedAt: null, inProgress: false });
  assert.match(html, /Never/);
  assert.match(html, /unavailable/);
});

test('#2 overlay shows an in-progress (disabled) state while syncing', () => {
  const html = overlay.buildDesktopOverlayHTML({ available: true, commit: 'abc1234', recordCount: 130, lastSyncedAt: '2026-08-20T00:00:00.000Z', inProgress: true });
  assert.match(html, /disabled/);
  assert.match(html, /Syncing…/);
  assert.match(html, /aria-busy="true"/);
});

test('#18/#19 the exposed bridge surface is exactly the narrow allowlist', () => {
  const expected = ['isDesktop', 'getStatus', 'chooseCanonicalRepo', 'syncLore', 'onStatusUpdate'].sort();
  assert.deepEqual([...overlay.DESKTOP_METHODS].sort(), expected);
  // No generic process/fs/child-process/IPC/command APIs are exposed.
  for (const forbidden of overlay.FORBIDDEN_EXPOSED) {
    assert.ok(!overlay.DESKTOP_METHODS.includes(forbidden), `must not expose ${forbidden}`);
  }
});

test('#18/#19 the preload exposes exactly DESKTOP_METHODS and no forbidden APIs', async () => {
  const preload = await readFile(join(__dirname, 'preload.cjs'), 'utf8');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('toadaidDesktop'/, 'exposes a single namespaced bridge');
  // The bridge object must be the only thing exposed; assert it references the
  // allowlisted methods and does not expose forbidden APIs by name.
  for (const m of overlay.DESKTOP_METHODS) {
    assert.ok(new RegExp(`\\b${m}\\b`).test(preload), `preload must define bridge method ${m}`);
  }
  for (const forbidden of overlay.FORBIDDEN_EXPOSED) {
    // The forbidden name may appear ONLY as a literal string in the guard list,
    // never as a property/key on the exposed bridge object.
    assert.ok(!new RegExp(`bridge\\.${forbidden}\\b`).test(preload), `preload must not attach forbidden API ${forbidden} to the bridge`);
    assert.ok(!new RegExp(`'${forbidden}'\\s*:`).test(preload), `preload must not expose forbidden key ${forbidden}`);
  }
  // No generic command runner / arbitrary IPC forwarding.
  assert.doesNotMatch(preload, /runCommand|invoke\(\s*[a-z_]\w*\s*\+|ipcRenderer\.send\b/);
});

test('renderStatusMessage surfaces success/refusal/build-failure without false claims', () => {
  const success = overlay.renderStatusMessage({ kind: 'success', commit: 'abc1234567', recordCount: 130, syncedAt: '2026-08-20T00:00:00.000Z' });
  assert.match(success, /Lore synced/);
  assert.match(success, /Records: 130/);
  assert.match(success, /Generation: abc1234/);
  assert.doesNotMatch(success, /Reader update/);

  const refused = overlay.renderStatusMessage({ kind: 'refused', reason: 'Duplicate canonical id: TOBY_1756312669192' });
  assert.match(refused, /Lore sync refused/);
  assert.match(refused, /Duplicate canonical id/);
  assert.match(refused, /preserved/);

  const buildFailed = overlay.renderStatusMessage({ kind: 'build-failed', commit: 'abc1234567' });
  assert.match(buildFailed, /rebuild failed/);
  assert.doesNotMatch(buildFailed, /Lore synced$/);
  assert.doesNotMatch(buildFailed, /Lore Reader updated/);
});