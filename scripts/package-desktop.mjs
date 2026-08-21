#!/usr/bin/env node
import { packager } from '@electron/packager';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateDesktopPayload } from './validate-desktop-package.mjs';

const ROOT = resolve('.');
const RELEASE = resolve(ROOT, 'release');
const DIST = resolve(ROOT, 'dist');
const PRODUCT = 'The Pond Archive';
const RUNTIME_FILES = ['desktop/packaged-main.mjs', 'desktop/static-reader-host.mjs', 'desktop/navigation-policy.mjs', 'desktop/single-instance.mjs'];

function fail(message) { throw new Error(`Desktop packaging refused: ${message}`); }
function hostIsLinuxX64() { return process.platform === 'linux' && process.arch === 'x64'; }
function electronVersion() { return JSON.parse(readFileSync(resolve(ROOT, 'node_modules/electron/package.json'), 'utf8')).version; }
export function stagePackagedApp({ root = ROOT, release = RELEASE, dist = DIST } = {}) {
  if (!existsSync(dist)) fail('dist/ is missing; run the ordinary non-PWA build first');
  const stage = mkdtempSync(join(release, '.stage-'));
  const sourcePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ name: 'toadaid-lore-reader-desktop', productName: PRODUCT, version: sourcePackage.version, main: 'desktop/packaged-main.mjs', type: 'module', private: true }, null, 2)}\n`);
  for (const path of RUNTIME_FILES) {
    const destination = join(stage, path);
    mkdirSync(resolve(destination, '..'), { recursive: true });
    cpSync(join(root, path), destination);
  }
  cpSync(dist, join(stage, 'dist'), { recursive: true });
  validateDesktopPayload(stage);
  return stage;
}
async function main() {
  if (!hostIsLinuxX64()) fail(`Linux x64 packaging requires linux/x64, received ${process.platform}/${process.arch}`);
  if (process.env.PUBLIC_PWA === '1') fail('packaged runtime requires the ordinary non-PWA Reader build');
  mkdirSync(RELEASE, { recursive: true });
  const stage = stagePackagedApp();
  const output = join(RELEASE, `${PRODUCT}-linux-x64`);
  rmSync(output, { recursive: true, force: true });
  try {
    await packager({ dir: stage, out: RELEASE, name: PRODUCT, platform: 'linux', arch: 'x64', electronVersion: electronVersion(), overwrite: true, prune: true, asar: false });
    const appDirectory = join(output, 'resources', 'app');
    const result = validateDesktopPayload(appDirectory);
    console.log(`DESKTOP_PACKAGE_OK path=${output} payload_files=${result.files} records=${result.records} electron=${electronVersion()}`);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
