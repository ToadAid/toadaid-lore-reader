import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { validateDesktopPackage, validateDesktopPayload } from '../scripts/validate-desktop-package.mjs';
import { packageTarget } from '../scripts/package-desktop.mjs';

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

test('shared packager admits Linux, Windows, and both macOS portable targets only', () => {
  assert.deepEqual(packageTarget(['--platform', 'linux', '--arch', 'x64']), { platform: 'linux', arch: 'x64' });
  assert.deepEqual(packageTarget(['--platform', 'win32', '--arch', 'x64']), { platform: 'win32', arch: 'x64' });
  assert.deepEqual(packageTarget(['--platform', 'darwin', '--arch', 'x64']), { platform: 'darwin', arch: 'x64' });
  assert.deepEqual(packageTarget(['--platform', 'darwin', '--arch', 'arm64']), { platform: 'darwin', arch: 'arm64' });
  for (const target of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'ia32']]) assert.throws(() => packageTarget(['--platform', target[0], '--arch', target[1]]), /supported targets/);
});

test('macOS package validation requires the .app executable and shared Resources/app payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'toadaid-macos-package-'));
  try {
    const app = join(root, 'The Pond Archive.app', 'Contents');
    for (const path of ['MacOS', 'Resources/app/desktop', 'Resources/app/dist/chronicle', 'Resources/app/dist/bookmarks', 'Resources/app/dist/record/ONE']) mkdirSync(join(app, path), { recursive: true });
    writeFileSync(join(app, 'MacOS', 'The Pond Archive'), 'Mach-O');
    writeFileSync(join(app, 'Resources/app/package.json'), '{}');
    for (const file of ['packaged-main.mjs', 'static-reader-host.mjs', 'navigation-policy.mjs', 'single-instance.mjs']) writeFileSync(join(app, 'Resources/app/desktop', file), 'safe');
    for (const file of ['index.html', 'chronicle/index.html', 'bookmarks/index.html', 'record/ONE/index.html']) writeFileSync(join(app, 'Resources/app/dist', file), '<!doctype html>');
    const result = validateDesktopPackage({ packageDirectory: root, platform: 'darwin', arch: 'arm64' });
    assert.equal(result.records, 1);
    assert.match(result.executable, /The Pond Archive\.app\/Contents\/MacOS\/The Pond Archive$/);
    assert.match(result.appDirectory, /The Pond Archive\.app\/Contents\/Resources\/app$/);
    rmSync(join(app, 'MacOS', 'The Pond Archive'));
    assert.throws(() => validateDesktopPackage({ packageDirectory: root, platform: 'darwin', arch: 'x64' }), /missing or empty darwin executable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Windows package validation requires a non-empty .exe and shared payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'toadaid-windows-package-'));
  try {
    for (const path of ['resources/app/desktop', 'resources/app/dist/chronicle', 'resources/app/dist/bookmarks', 'resources/app/dist/record/ONE']) mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'The Pond Archive.exe'), 'MZ');
    writeFileSync(join(root, 'resources/app/package.json'), '{}');
    for (const file of ['packaged-main.mjs', 'static-reader-host.mjs', 'navigation-policy.mjs', 'single-instance.mjs']) writeFileSync(join(root, 'resources/app/desktop', file), 'safe');
    for (const file of ['index.html', 'chronicle/index.html', 'bookmarks/index.html', 'record/ONE/index.html']) writeFileSync(join(root, 'resources/app/dist', file), '<!doctype html>');
    assert.equal(validateDesktopPackage({ packageDirectory: root, platform: 'win32', arch: 'x64' }).records, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
