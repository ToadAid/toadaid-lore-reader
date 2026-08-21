#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { normalizePublicBase } from '../src/lib/public-site.ts';

function fail(message) {
  throw new Error(`Public build validation failed: ${message}`);
}

function filesBelow(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(path));
    else result.push(path);
  }
  return result;
}

function localTarget(value, base) {
  if (!value || value.startsWith('#') || value.startsWith('//')) return null;
  if (/^(?:[a-z][a-z\d+.-]*:)/i.test(value)) return null;
  if (!value.startsWith('/')) return null;
  if (base !== '/' && !value.startsWith(base)) fail(`root URL escapes Pages base: ${value}`);
  const withoutBase = base === '/' ? value.slice(1) : value.slice(base.length);
  return decodeURIComponent(withoutBase.split(/[?#]/, 1)[0]);
}

function outputPath(directory, target) {
  if (target === '' || target.endsWith('/')) return resolve(directory, target, 'index.html');
  return resolve(directory, target);
}

export function validatePublicBuild(directory, requestedBase) {
  const root = resolve(directory);
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`missing output directory ${root}`);
  const base = normalizePublicBase(requestedBase);
  const files = filesBelow(root);
  const documents = files.filter((file) => /\.(?:html|css)$/i.test(file));
  if (documents.length === 0) fail('no generated HTML/CSS found');

  const references = [];
  for (const file of documents) {
    const text = readFileSync(file, 'utf8');
    const patterns = [
      /\b(?:href|src|data-share-url)\s*=\s*["']([^"']+)["']/gi,
      /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) references.push({ file, value: match[1] });
    }
  }

  let internalReferences = 0;
  for (const { file, value } of references) {
    const target = localTarget(value, base);
    if (target === null) continue;
    internalReferences += 1;
    const path = outputPath(root, target);
    if (!existsSync(path)) {
      fail(`${relative(root, file)} references missing ${value} (${relative(root, path)})`);
    }
  }

  for (const required of ['index.html', 'chronicle/index.html', 'bookmarks/index.html']) {
    if (!existsSync(resolve(root, required))) fail(`required route output missing: ${required}`);
  }
  const recordRoot = resolve(root, 'record');
  if (!existsSync(recordRoot) || !files.some((file) => file.startsWith(`${recordRoot}${sep}`) && file.endsWith(`${sep}index.html`))) {
    fail('no generated record route found');
  }
  for (const asset of [
    'art/pond-archive/cover-desktop.png',
    'art/pond-archive/cover-mobile.png',
    'art/pond-archive/pond-archive-lotus-moon.png',
  ]) {
    if (!existsSync(resolve(root, asset))) fail(`required public asset missing: ${asset}`);
  }

  return { base, documents: documents.length, internalReferences };
}

export function validatePwa(directory, requestedBase) {
  const base = normalizePublicBase(requestedBase);
  const manifestPath = resolve(directory, 'manifest.webmanifest');
  const workerPath = resolve(directory, 'sw.js');
  if (!existsSync(manifestPath)) fail('public PWA manifest missing');
  if (!existsSync(workerPath)) fail('public PWA service worker missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [name, value] of [['start_url', manifest.start_url], ['scope', manifest.scope]]) {
    if (typeof value !== 'string' || !value.startsWith(base)) fail(`manifest ${name} escapes public base`);
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) fail('manifest lacks practical icon coverage');
  for (const icon of manifest.icons) {
    if (!icon || typeof icon.src !== 'string' || !icon.src.startsWith(base)) fail('manifest icon escapes public base');
    if (!existsSync(outputPath(directory, icon.src.slice(base.length)))) fail(`manifest icon missing: ${icon.src}`);
  }
  const worker = readFileSync(workerPath, 'utf8');
  if (/toadaid\.github\.io\/lore\/data\.json|raw\.githubusercontent\.com[^"']*\/lore\/data\.json/i.test(worker)) fail('service worker contains canonical runtime fetch target');
  if (/https?:\/\//i.test(worker.replace(/https?:\/\/[^\n]*/g, ''))) fail('service worker contains unexpected external URL');
  const precache = worker.match(/const PRECACHE = (\[[\s\S]*?\]);/);
  if (!precache) fail('service worker precache list missing');
  const resources = JSON.parse(precache[1]);
  let bytes = 0;
  for (const resource of resources) {
    if (typeof resource !== 'string' || !resource.startsWith(base) || /^(?:https?:)?\/\//i.test(resource)) fail(`precache resource escapes public base: ${resource}`);
    const local = resource.slice(base.length);
    const path = outputPath(directory, local);
    if (!existsSync(path)) fail(`precache resource missing from artifact: ${resource}`);
    bytes += statSync(path).size;
  }
  for (const route of [base, `${base}chronicle/`, `${base}bookmarks/`]) if (!resources.includes(route)) fail(`required offline route missing: ${route}`);
  const recordRoutes = resources.filter((resource) => resource.startsWith(`${base}record/`) && resource.endsWith('/'));
  const recordOutput = filesBelow(resolve(directory, 'record')).filter((file) => file.endsWith(`${sep}index.html`));
  if (recordRoutes.length !== recordOutput.length) fail('precache does not contain every canonical record route');
  const expectedPrecache = filesBelow(directory)
    .map((file) => relative(directory, file).replaceAll('\\', '/'))
    .filter((file) => file !== 'sw.js')
    .map((file) => {
      if (file === 'index.html') return base;
      if (file.endsWith('/index.html')) return `${base}${file.slice(0, -'index.html'.length)}`;
      return `${base}${file}`;
    })
    .sort();
  const sortedResources = [...resources].sort();
  if (
    expectedPrecache.length !== sortedResources.length
    || expectedPrecache.some((resource, index) => resource !== sortedResources[index])
  ) {
    fail('precache does not close over the complete generated static Reader artifact');
  }
  for (const suffix of ['.css', '.png']) {
    if (!resources.some((resource) => resource.endsWith(suffix))) fail(`precache lacks local ${suffix} Reader asset`);
  }
  const index = readFileSync(resolve(directory, 'index.html'), 'utf8');
  if (!index.includes(`manifest.webmanifest`) || !index.includes(`register(serviceWorkerUrl`)) fail('public PWA registration missing from cover');
  if (!/apple-mobile-web-app-capable" content="yes"/.test(index) || !/apple-mobile-web-app-title" content="Pond Archive"/.test(index)) fail('iOS home-screen metadata missing');
  if (!new RegExp(`apple-touch-icon" href="${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}art/pond-archive/pwa-icon-192\\.png"`).test(index)) fail('base-aware apple touch icon missing');
  if (/maximum-scale|user-scalable\s*=\s*no/i.test(index)) fail('viewport suppresses zoom');
  return { entries: resources.length, bytes, htmlRoutes: resources.filter((resource) => resource.endsWith('/')).length, recordRoutes: recordRoutes.length };
}

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail('arguments must be --name value pairs');
    args[key.slice(2)] = value;
  }
  if (!args.dir || !args.base) fail('required arguments: --dir and --base');
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = argsFrom(process.argv.slice(2));
    const result = validatePublicBuild(args.dir, args.base);
    const pwa = args.pwa === '1' ? validatePwa(args.dir, args.base) : null;
    console.log(`PUBLIC_BUILD_VALID base=${result.base} documents=${result.documents} internal_references=${result.internalReferences}${pwa ? ` precache_entries=${pwa.entries} precache_bytes=${pwa.bytes} html_routes=${pwa.htmlRoutes} record_routes=${pwa.recordRoutes}` : ''}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
