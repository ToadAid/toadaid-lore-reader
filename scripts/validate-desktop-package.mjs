#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

function fail(message) { throw new Error(`Desktop package validation failed: ${message}`); }
function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
export function validateDesktopPayload(appDirectory) {
  const root = resolve(appDirectory);
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`missing application payload ${root}`);
  const required = ['package.json', 'desktop/packaged-main.mjs', 'desktop/static-reader-host.mjs', 'desktop/navigation-policy.mjs', 'desktop/single-instance.mjs', 'dist/index.html', 'dist/chronicle/index.html', 'dist/bookmarks/index.html'];
  for (const path of required) if (!existsSync(resolve(root, path))) fail(`required payload path missing: ${path}`);
  const files = filesBelow(root);
  if (!files.some((file) => file.startsWith(`${resolve(root, 'dist/record')}${sep}`) && file.endsWith(`${sep}index.html`))) fail('no packaged canonical record routes');
  for (const forbidden of ['desktop/main.mjs', 'desktop/preload.cjs', 'desktop/desktop-overlay.cjs', 'desktop/native-sync.mjs', 'desktop/lore-sync-service.mjs', 'desktop/settings-store.mjs', 'scripts/sync-canonical-lore.mjs', 'scripts/import-canonical-lore.mjs', 'lore/data.json', '.git', '.codegraph', 'src']) {
    if (existsSync(resolve(root, forbidden))) fail(`forbidden operator/source material staged: ${forbidden}`);
  }
  const packagedMain = readFileSync(resolve(root, 'desktop/packaged-main.mjs'), 'utf8');
  if (/desktop:(?:sync-lore|choose-repo)|native-sync|lore-sync-service|settings-store|ipcMain|preload\.cjs/i.test(packagedMain)) fail('packaged entrypoint exposes operator authority');
  for (const file of files.filter((file) => /\.(?:html|js|mjs)$/i.test(file))) {
    const text = readFileSync(file, 'utf8');
    if (/serviceWorker\.register|manifest\.webmanifest|\bsw\.js\b/i.test(text)) fail(`PWA runtime material staged: ${relative(root, file)}`);
    if (/\/home\/tommy\/toadaid-lore-reader|\/home\/tommy\/toadaid\.github\.io/i.test(text)) fail(`source checkout path staged: ${relative(root, file)}`);
  }
  return { files: files.length, records: files.filter((file) => file.includes(`${sep}record${sep}`) && file.endsWith(`${sep}index.html`)).length };
}
export function validateDesktopPackage({ packageDirectory, platform, arch }) {
  if (!['linux/x64', 'win32/x64', 'darwin/x64', 'darwin/arm64'].includes(`${platform}/${arch}`)) fail(`unsupported package target ${platform}/${arch}`);
  const root = resolve(packageDirectory);
  const bundle = platform === 'darwin' ? resolve(root, 'The Pond Archive.app') : root;
  const executable = platform === 'darwin'
    ? resolve(bundle, 'Contents', 'MacOS', 'The Pond Archive')
    : resolve(root, platform === 'win32' ? 'The Pond Archive.exe' : 'The Pond Archive');
  if (!existsSync(executable) || statSync(executable).size === 0) fail(`missing or empty ${platform} executable`);
  const appDirectory = platform === 'darwin'
    ? resolve(bundle, 'Contents', 'Resources', 'app')
    : resolve(root, 'resources', 'app');
  const payload = validateDesktopPayload(appDirectory);
  return { ...payload, executable, appDirectory };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const directory = process.argv[2];
    if (!directory) fail('usage: validate-desktop-package.mjs <resources/app directory>');
    const result = validateDesktopPayload(directory);
    console.log(`DESKTOP_PACKAGE_VALID files=${result.files} records=${result.records}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
