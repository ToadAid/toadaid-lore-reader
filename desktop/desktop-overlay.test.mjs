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
  assert.match(html, /data-expanded="false"/);
  assert.match(html, /data-toadaid-details hidden/, 'details are collapsed by default');
  assert.match(html, /aria-expanded="false"/);
});

test('#2 overlay shows Never/unavailable when no generation exists', () => {
  const html = overlay.buildDesktopOverlayHTML({ available: false, lastSyncedAt: null, inProgress: false });
  assert.match(html, /Never/);
  assert.match(html, /unavailable/);
  assert.match(html, /Source: <span>Not configured<\/span>/);
  assert.match(html, />Choose Lore Folder</);
});

test('expanded overlay shows only the bounded source basename and can be collapsed', () => {
  const html = overlay.buildDesktopOverlayHTML({
    available: true,
    commit: 'abc1234',
    recordCount: 130,
    sourceConfigured: true,
    sourceName: 'toadaid.github.io',
  }, { expanded: true });
  assert.match(html, /data-expanded="true"/);
  assert.doesNotMatch(html, /data-toadaid-details hidden/);
  assert.match(html, /Source: <span>toadaid\.github\.io<\/span>/);
  assert.match(html, />Change Lore Folder</);
  assert.match(html, /data-toadaid-action="collapse"/);
  assert.doesNotMatch(html, /\/home\/|[A-Z]:\\/, 'must not display a filesystem path');
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
  assert.doesNotMatch(preload, /window\.toadaidDesktop/, 'trusted overlay must not route back through the main-world exposure');
  assert.match(preload, /createDesktopOverlayController\(bridge, updateOverlay\)/);
  assert.match(preload, /nodeIntegration:\s*false|contextIsolation:\s*true/);
});

test('trusted overlay Sync Lore action calls the local bridge exactly once', async () => {
  let syncCalls = 0;
  const bridge = {
    syncLore: async () => { syncCalls += 1; return { kind: 'success' }; },
    getStatus: async () => ({}),
    chooseCanonicalRepo: async () => null,
    onStatusUpdate: () => () => {},
  };
  const controller = overlay.createDesktopOverlayController(bridge, () => {});
  await controller.syncLore();
  assert.equal(syncCalls, 1);
});

test('refreshStatus and status subscription use the local trusted bridge', async () => {
  let getStatusCalls = 0;
  let subscriptionCalls = 0;
  let listener;
  const updates = [];
  const status = { available: true, commit: 'abc1234' };
  const bridge = {
    syncLore: async () => ({}),
    getStatus: async () => { getStatusCalls += 1; return status; },
    chooseCanonicalRepo: async () => null,
    onStatusUpdate: (callback) => { subscriptionCalls += 1; listener = callback; return () => {}; },
  };
  const controller = overlay.createDesktopOverlayController(bridge, (value) => updates.push(value));
  assert.equal(await controller.refreshStatus(), status);
  assert.equal(getStatusCalls, 1);
  controller.subscribe();
  assert.equal(subscriptionCalls, 1);
  listener({ available: false });
  assert.deepEqual(updates, [status, { available: false }]);
});

test('folder cancellation does not refresh or sync; selection refreshes without syncing', async () => {
  let chooseResult = null;
  let chooseCalls = 0;
  let getStatusCalls = 0;
  let syncCalls = 0;
  const bridge = {
    syncLore: async () => { syncCalls += 1; },
    getStatus: async () => { getStatusCalls += 1; return { sourceConfigured: true, sourceName: 'toadaid.github.io' }; },
    chooseCanonicalRepo: async () => { chooseCalls += 1; return chooseResult; },
    onStatusUpdate: () => () => {},
  };
  const controller = overlay.createDesktopOverlayController(bridge, () => {});
  assert.equal(await controller.chooseCanonicalRepo(), null);
  assert.equal(getStatusCalls, 0);
  assert.equal(syncCalls, 0);
  chooseResult = true;
  assert.equal(await controller.chooseCanonicalRepo(), true);
  assert.equal(chooseCalls, 2);
  assert.equal(getStatusCalls, 1);
  assert.equal(syncCalls, 0);
});

test('preload chrome is fixed, bounded, collapsible, and wraps status errors', async () => {
  const preload = await readFile(join(__dirname, 'preload.cjs'), 'utf8');
  assert.match(preload, /position:fixed/);
  assert.match(preload, /width:260px/);
  assert.match(preload, /max-width:min\(272px,calc\(100vw - 24px\)\)/);
  assert.match(preload, /overflow-wrap:anywhere/);
  assert.match(preload, /panelState = \{ expanded: false/);
  assert.doesNotMatch(preload, /position:fixed[^;]*;[^\n]*(?:width:100vw|height:100vh)/);
});

test('native folder picker is bounded and persists only after a successful selection', async () => {
  const main = await readFile(join(__dirname, 'main.mjs'), 'utf8');
  const start = main.indexOf("ipcMain.handle('desktop:choose-repo'");
  const end = main.indexOf("ipcMain.handle('desktop:sync-lore'", start);
  assert.ok(start >= 0 && end > start);
  const handler = main.slice(start, end);
  assert.match(handler, /properties: \['openDirectory'\]/);
  assert.match(handler, /result\.canceled[^\n]+return null/);
  assert.match(handler, /settingsStore\.setCanonicalRepoPath\(selected\)/);
  assert.match(handler, /pushStatus\(service\)/);
  assert.match(handler, /return true/);
  assert.doesNotMatch(handler, /service\.syncLore|return selected/);
});

test('Canonical Archive is cover-local lower-left on desktop and mobile-safe', async () => {
  const css = await readFile(join(REPO_ROOT, 'src', 'styles', 'pond-archive.css'), 'utf8');
  assert.match(css, /\.archive-cover > \.source-note \{ position: absolute; left: clamp\(1\.25rem, 2vw, 2rem\); bottom: clamp\(1\.25rem, 2vw, 2rem\)/);
  assert.match(css, /\.archive-cover > \.cover-footnote \{ position: absolute; right: clamp\(1\.5rem, 4vw, 4rem\); bottom: clamp\(1\.25rem, 2vw, 2rem\)/, 'archive footnote wins the cover-child positioning rule and shares the true bottom edge band');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.archive-cover > \.source-note \{ position: relative; left: auto; bottom: auto;/);
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
