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
    console.log(`PUBLIC_BUILD_VALID base=${result.base} documents=${result.documents} internal_references=${result.internalReferences}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
