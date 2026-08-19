#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildLegacyMediaCandidateManifest, validateLegacyMediaCandidateManifest } from '../src/lib/lore/legacy-media-candidates.ts';

const EXPECTED = Object.freeze({
  repository: 'ToadAid/toadaid.github.io',
  sourcePath: 'lore/data.json',
  commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
});

function fail(message) { throw new Error(`Canonical lore import refused: ${message}`); }

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) fail('arguments must be --name value pairs');
    args[key.slice(2)] = value;
  }
  for (const key of ['source', 'repository', 'source-path', 'commit']) if (!args[key]) fail(`missing --${key}`);
  return args;
}

function assertExactProvenance(args) {
  if (args.repository !== EXPECTED.repository) fail('repository is not the exact canonical repository');
  if (args['source-path'] !== EXPECTED.sourcePath) fail('source path is not the exact canonical path');
  if (args.commit !== EXPECTED.commit) fail('commit is not the exact canonical commit');
}

function assertRecord(record, index) {
  if (!record || Array.isArray(record) || typeof record !== 'object') fail(`record ${index} is not an object`);
  for (const field of ['id', 'date', 'title', 'comment']) {
    if (typeof record[field] !== 'string' || record[field].trim() === '') fail(`record ${index} has no usable ${field}`);
  }
  for (const field of ['original', 'url', 'img', 'tags']) {
    if (field in record && typeof record[field] !== 'string') fail(`record ${index} has non-string ${field}`);
  }
}

export function buildSnapshot(sourceBytes, provenance, generatedAt = new Date().toISOString()) {
  if (provenance.repository !== EXPECTED.repository || provenance.path !== EXPECTED.sourcePath || provenance.commit !== EXPECTED.commit) {
    fail('provenance is not bound to the exact canonical source');
  }
  let records;
  try { records = JSON.parse(sourceBytes); } catch { fail('source is not valid JSON'); }
  if (!Array.isArray(records)) fail('top-level source must be an array');
  const ids = new Set();
  for (const [index, record] of records.entries()) {
    assertRecord(record, index);
    if (ids.has(record.id)) fail(`duplicate canonical id ${record.id}`);
    ids.add(record.id);
  }
  if (Number.isNaN(Date.parse(generatedAt))) fail('generatedAt is invalid');
  const sourceDigest = `sha256:${createHash('sha256').update(sourceBytes).digest('hex')}`;
  const source = {
    schemaVersion: '1.0.0',
    repository: provenance.repository,
    path: provenance.path,
    commit: provenance.commit,
    sourceDigest,
    recordCount: records.length,
    generatedAt,
  };
  const snapshotRecords = records.map((canonical) => ({
    canonicalId: canonical.id,
    canonical,
    chronology: {
      archiveChronologyMarker: canonical.date,
      sortKey: `${canonical.date}\u0000${canonical.id}`,
      hasVerifiedPublicationTimestamp: false,
    },
  })).sort((left, right) => left.chronology.sortKey.localeCompare(right.chronology.sortKey));
  return { source, snapshot: { schemaVersion: '1.0.0', provenance: source, records: snapshotRecords } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExactProvenance(args);
  const sourcePath = resolve(args.source);
  const sourceBytes = await readFile(sourcePath, 'utf8');
  const { source, snapshot } = buildSnapshot(sourceBytes, {
    repository: args.repository,
    path: args['source-path'],
    commit: args.commit,
  }, args['generated-at']);
  const outputDirectory = resolve(args.output ?? 'generated');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'reader-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(resolve(outputDirectory, 'LORE_SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);

  // Derived legacy-media candidate manifest, from the SAME canonical load,
  // provenance, and snapshot generation. Build then self-validate before
  // writing so the generated output is provably consistent. No network, no
  // media fetching; derived solely from canonical bytes.
  const candidateManifest = buildLegacyMediaCandidateManifest(snapshot.records, source);
  validateLegacyMediaCandidateManifest(candidateManifest, snapshot);
  await writeFile(resolve(outputDirectory, 'legacy-media-candidates.json'), `${JSON.stringify(candidateManifest, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
