import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CANONICAL = Object.freeze({
  repository: 'ToadAid/toadaid.github.io',
  path: 'lore/data.json',
  commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
});

export type ArchiveCoverState =
  | { status: 'unavailable' }
  | {
      status: 'verified';
      recordCount: number;
      canonicalCommit: string;
      repository: string;
      path: string;
      sourceDigest: string;
    };

function fail(message: string): never {
  throw new Error(`Generated archive state refused: ${message}`);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${name} is not an object`);
  return value as Record<string, unknown>;
}

function readJson(path: string, name: string): Record<string, unknown> {
  try {
    return object(JSON.parse(readFileSync(path, 'utf8')), name);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Generated archive state refused:')) throw error;
    fail(`${name} is not valid JSON`);
  }
}

function assertProvenance(value: Record<string, unknown>, name: string): void {
  if (value.repository !== CANONICAL.repository) fail(`${name} repository is not canonical`);
  if (value.path !== CANONICAL.path) fail(`${name} path is not canonical`);
  if (value.commit !== CANONICAL.commit) fail(`${name} commit is not canonical`);
  if (!Number.isInteger(value.recordCount) || (value.recordCount as number) < 1) fail(`${name} record count is invalid`);
  if (typeof value.sourceDigest !== 'string' || !value.sourceDigest.startsWith('sha256:')) fail(`${name} source digest is invalid`);
}

/** Reads only importer-generated artifacts; invalid present artifacts fail closed. */
export function loadArchiveCoverState(generatedDirectory = resolve(process.cwd(), 'generated')): ArchiveCoverState {
  const snapshotPath = resolve(generatedDirectory, 'reader-snapshot.json');
  const provenancePath = resolve(generatedDirectory, 'LORE_SOURCE.json');
  const hasSnapshot = existsSync(snapshotPath);
  const hasProvenance = existsSync(provenancePath);
  if (!hasSnapshot && !hasProvenance) return { status: 'unavailable' };
  if (!hasSnapshot || !hasProvenance) fail('snapshot and provenance must be present together');

  const provenance = readJson(provenancePath, 'LORE_SOURCE.json');
  const snapshot = readJson(snapshotPath, 'reader-snapshot.json');
  assertProvenance(provenance, 'LORE_SOURCE.json');
  const snapshotProvenance = object(snapshot.provenance, 'snapshot provenance');
  assertProvenance(snapshotProvenance, 'snapshot provenance');
  if (JSON.stringify(snapshotProvenance) !== JSON.stringify(provenance)) fail('snapshot provenance does not match LORE_SOURCE.json');
  if (!Array.isArray(snapshot.records) || snapshot.records.length !== provenance.recordCount) fail('snapshot record count does not match provenance');
  const ids = snapshot.records.map((entry, index) => {
    const record = object(entry, `snapshot record ${index}`);
    if (typeof record.canonicalId !== 'string' || record.canonicalId.length === 0) fail(`snapshot record ${index} canonical ID is invalid`);
    const canonical = object(record.canonical, `snapshot record ${index} canonical payload`);
    if (canonical.id !== record.canonicalId) fail(`snapshot record ${index} rewrites canonical ID`);
    return record.canonicalId;
  });
  if (new Set(ids).size !== provenance.recordCount) fail('snapshot canonical IDs are not unique');

  return {
    status: 'verified',
    recordCount: provenance.recordCount as number,
    canonicalCommit: provenance.commit as string,
    repository: provenance.repository as string,
    path: provenance.path as string,
    sourceDigest: provenance.sourceDigest as string,
  };
}
