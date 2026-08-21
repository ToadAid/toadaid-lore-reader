#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { normalizePublicBase, publicPath } from '../src/lib/public-site.ts';

function fail(message) { throw new Error(`Reader build failed: ${message}`); }
function exactSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value || '')) fail(`${label} must be an exact lowercase SHA`);
  return value;
}
function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
export function offlineGenerationKey(readerSha, canonicalSha) {
  return `toadaid-reader-pwa-v1-reader-${exactSha(readerSha, 'Reader SHA')}-lore-${exactSha(canonicalSha, 'Canonical SHA')}`;
}
export function precachePaths(directory, base) {
  const normalizedBase = normalizePublicBase(base);
  return filesBelow(directory).map((file) => {
    const path = relative(directory, file).replaceAll('\\', '/');
    if (path === 'index.html') return publicPath('/', normalizedBase);
    if (path.endsWith('/index.html')) return publicPath(`/${path.slice(0, -'index.html'.length)}`, normalizedBase);
    return publicPath(`/${path}`, normalizedBase);
  }).sort();
}
export function writePublicPwa(directory, { base, readerSha, canonicalSha }) {
  const normalizedBase = normalizePublicBase(base);
  const cacheName = offlineGenerationKey(readerSha, canonicalSha);
  const manifest = {
    name: 'The Pond Archive', short_name: 'Pond Archive', start_url: normalizedBase,
    scope: normalizedBase, display: 'standalone', theme_color: '#101827', background_color: '#101827',
    icons: [
      { src: publicPath('/art/pond-archive/pwa-icon-192.png', normalizedBase), sizes: '192x192', type: 'image/png' },
      { src: publicPath('/art/pond-archive/pwa-icon-512.png', normalizedBase), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  writeFileSync(resolve(directory, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
  const resources = precachePaths(directory, normalizedBase);
  const serviceWorker = `/* Generated verified static Reader archive. No canonical runtime source is fetched. */\nconst CACHE_NAME = ${JSON.stringify(cacheName)};\nconst BASE = ${JSON.stringify(normalizedBase)};\nconst PRECACHE = ${JSON.stringify(resources)};\nconst OWNED_PREFIX = 'toadaid-reader-pwa-v1-';\nself.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))); });\nself.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith(OWNED_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))); });\nself.addEventListener('fetch', (event) => { const request = event.request; const url = new URL(request.url); if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return; event.respondWith(caches.match(request).then((hit) => { if (hit) return hit; if (request.mode !== 'navigate') return fetch(request); const pathname = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'; return caches.match(pathname).then((page) => page || fetch(request)); })); });\n`;
  writeFileSync(resolve(directory, 'sw.js'), serviceWorker);
  return { cacheName, resources, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const astro = spawnSync('astro', ['build'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (astro.status !== 0) process.exitCode = astro.status || 1;
  else if (process.env.PUBLIC_PWA === '1') {
    const source = JSON.parse(readFileSync('generated/LORE_SOURCE.json', 'utf8'));
    const readerSha = process.env.PUBLIC_READER_SHA || spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const result = writePublicPwa(resolve('dist'), { base: process.env.PUBLIC_BASE, readerSha, canonicalSha: source.commit });
    console.log(`PUBLIC_PWA_OK cache=${result.cacheName} resources=${result.resources.length}`);
  }
}
