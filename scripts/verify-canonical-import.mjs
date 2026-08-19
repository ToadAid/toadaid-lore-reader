#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const EXPECTED = Object.freeze({
  repository: 'ToadAid/toadaid.github.io',
  path: 'lore/data.json',
  commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
  recordCount: 130,
});

function fail(message) { throw new Error(`Canonical import proof failed: ${message}`); }

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail('arguments must be --name value pairs');
    args[key.slice(2)] = value;
  }
  for (const key of ['source', 'snapshot', 'provenance']) if (!args[key]) fail(`missing --${key}`);
  return args;
}

export async function verifyCanonicalImport({ sourcePath, snapshotPath, provenancePath }) {
  const sourceBytes = await readFile(sourcePath);
  const source = JSON.parse(sourceBytes);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  if (!Array.isArray(source) || source.length !== EXPECTED.recordCount) fail('source record count is not 130');
  const sourceIds = source.map((record) => record.id);
  const sourceIdSet = new Set(sourceIds);
  if (sourceIdSet.size !== EXPECTED.recordCount) fail('source IDs are not unique');
  const byTitle = new Map(source.map((record) => [record.title, record]));
  if (byTitle.get('Trial of Patience')?.id !== 'TOBY_1756312669192') fail('Trial of Patience identity changed');
  if (byTitle.get('The Final Retweet')?.id !== 'TOBY_20250915_TheFinalRetweet') fail('The Final Retweet repair identity is absent');
  if (!Array.isArray(snapshot.records) || snapshot.records.length !== EXPECTED.recordCount) fail('snapshot record count is not 130');
  const snapshotIds = snapshot.records.map((record) => record.canonicalId);
  const snapshotIdSet = new Set(snapshotIds);
  if (snapshotIdSet.size !== EXPECTED.recordCount) fail('snapshot canonical IDs are not unique');
  const missing = sourceIds.filter((id) => !snapshotIdSet.has(id));
  const extra = snapshotIds.filter((id) => !sourceIdSet.has(id));
  const rewritten = snapshot.records.filter((record) => record.canonicalId !== record.canonical?.id);
  if (missing.length || extra.length || rewritten.length) fail('snapshot IDs do not exactly preserve source IDs');
  const digest = `sha256:${createHash('sha256').update(sourceBytes).digest('hex')}`;
  for (const value of [provenance, snapshot.provenance]) {
    if (value.repository !== EXPECTED.repository || value.path !== EXPECTED.path || value.commit !== EXPECTED.commit) fail('provenance is not exact');
    if (value.recordCount !== EXPECTED.recordCount || value.sourceDigest !== digest) fail('provenance count or digest is not exact');
  }
  return { digest, records: source.length, uniqueIds: sourceIdSet.size, missing: missing.length, extra: extra.length, rewritten: rewritten.length };
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const result = await verifyCanonicalImport({ sourcePath: args.source, snapshotPath: args.snapshot, provenancePath: args.provenance });
  console.log(`canonical records: ${result.records}`);
  console.log(`canonical unique IDs: ${result.uniqueIds}`);
  console.log('duplicate IDs: none');
  console.log(`snapshot records: ${result.records}`);
  console.log(`missing IDs: ${result.missing}; extra IDs: ${result.extra}; rewritten IDs: ${result.rewritten}`);
  console.log(`source digest: ${result.digest}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
