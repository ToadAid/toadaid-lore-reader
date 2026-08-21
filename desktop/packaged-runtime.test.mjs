import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { validateDesktopPayload } from '../scripts/validate-desktop-package.mjs';

const ROOT = resolve('.');
test('packaged entrypoint has no operator authority, IPC, preload, or source-checkout path', async () => {
  const source = await (await import('node:fs/promises')).readFile(join(ROOT, 'desktop/packaged-main.mjs'), 'utf8');
  for (const forbidden of ['native-sync', 'lore-sync-service', 'settings-store', 'ipcMain', 'desktop:sync-lore', 'desktop:choose-repo', 'preload.cjs', '/home/tommy/toadaid-lore-reader']) assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /nodeIntegration: false/);
  assert.match(source, /contextIsolation: true/);
  assert.match(source, /app\.getAppPath\(\)/);
});

test('desktop payload validator rejects PWA and operator material while requiring Reader routes', () => {
  const root = mkdtempSync(join(tmpdir(), 'toadaid-packaged-runtime-'));
  try {
    for (const path of ['desktop', 'dist/chronicle', 'dist/bookmarks', 'dist/record/ONE', 'dist/art/pond-archive']) mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    for (const file of ['packaged-main.mjs', 'static-reader-host.mjs', 'navigation-policy.mjs', 'single-instance.mjs']) writeFileSync(join(root, 'desktop', file), 'safe');
    for (const file of ['index.html', 'chronicle/index.html', 'bookmarks/index.html', 'record/ONE/index.html']) writeFileSync(join(root, 'dist', file), '<!doctype html>');
    assert.deepEqual(validateDesktopPayload(root), { files: 9, records: 1 });
    writeFileSync(join(root, 'dist/sw.js'), 'serviceWorker.register()');
    assert.throws(() => validateDesktopPayload(root), /PWA runtime material staged/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
