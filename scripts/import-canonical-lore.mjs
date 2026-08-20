#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CANONICAL_REPOSITORY, CANONICAL_PATH, FULL_SHA_RE } from '../src/lib/lore/provenance.ts';
import { readCanonicalBytes } from '../src/lib/lore/canonical-git-source.ts';
import { buildLegacyMediaCandidateManifest, validateLegacyMediaCandidateManifest } from '../src/lib/lore/legacy-media-candidates.ts';

function fail(message) { throw new Error(`Canonical lore import refused: ${message}`); }

// The ONLY arguments the operator may supply to the production canonical import
// CLI. Repository identity and canonical source path are PERMANENT Reader
// architecture constants (imported above); they are NOT accepted from the
// command line, so the caller cannot redefine canonical historical identity.
const ALLOWED_ARGS = new Set(['canonical-repo', 'commit', 'generated-at', 'output']);

// Obsolete weak-CLI flags that allowed arbitrary caller bytes plus an unrelated
// real commit SHA (false provenance). They are now rejected explicitly.
const OBSOLETE_ARGS = new Set(['source', 'repository', 'source-path']);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--')) fail('arguments must be --name value pairs');
    const name = key.slice(2);
    if (value === undefined || value.startsWith('--')) fail(`--${name} requires a value`);
    if (OBSOLETE_ARGS.has(name)) {
      fail(`--${name} is no longer accepted; the production canonical CLI binds bytes to the exact git object via --canonical-repo and --commit`);
    }
    if (!ALLOWED_ARGS.has(name)) fail(`unknown argument --${name}`);
    args[name] = value;
  }
  if (!args['canonical-repo']) fail('missing --canonical-repo (local canonical git repository path)');
  if (!args.commit) fail('missing --commit (exact full reviewed canonical commit SHA)');
  return args;
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
  // Permanent identity: repository and path are Reader architecture constants.
  if (provenance.repository !== CANONICAL_REPOSITORY) fail('provenance is not bound to the exact canonical repository');
  if (provenance.path !== CANONICAL_PATH) fail('provenance is not bound to the exact canonical path');
  // Advanceable generation: the commit must be an exact full reviewed SHA, but
  // it is NOT pinned to a single authorized commit forever.
  if (typeof provenance.commit !== 'string' || !FULL_SHA_RE.test(provenance.commit)) {
    fail('provenance commit is not an exact 40-character lowercase hex SHA');
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

  // ONE canonical load: bytes are mechanically obtained from the exact Git
  // object `<commit>:lore/data.json` inside the local canonical repository.
  // The caller cannot supply independent source bytes. No network, no mutation.
  const { bytes, commit, path } = readCanonicalBytes(args['canonical-repo'], args.commit);

  // Provenance identity comes from Reader constants, not the command line. The
  // commit is the exact reviewed SHA bound above.
  const { source, snapshot } = buildSnapshot(bytes, {
    repository: CANONICAL_REPOSITORY,
    path,
    commit,
  }, args['generated-at']);

  const outputDirectory = resolve(args.output ?? 'generated');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'reader-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(resolve(outputDirectory, 'LORE_SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);

  // Derived legacy-media candidate manifest, from the SAME canonical load,
  // provenance, and snapshot generation. Build then self-validate before
  // writing so the generated output is provably consistent. No network, no
  // media fetching; derived solely from the exact canonical bytes.
  const candidateManifest = buildLegacyMediaCandidateManifest(snapshot.records, source);
  validateLegacyMediaCandidateManifest(candidateManifest, snapshot);
  await writeFile(resolve(outputDirectory, 'legacy-media-candidates.json'), `${JSON.stringify(candidateManifest, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}