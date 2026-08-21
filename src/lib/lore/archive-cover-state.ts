import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANONICAL_REPOSITORY, CANONICAL_PATH, FULL_SHA_RE, SOURCE_DIGEST_RE } from './provenance.ts';

// Permanent identity only (Stage 2A-P2R2 §6/§7). The repository and path are
// fixed architecture constants. The generation commit and source digest are NOT
// pinned here — they are observed provenance that advance between Reader
// generations. The loader accepts ANY valid generation and refuses only
// malformed provenance form or a self-inconsistent/mixed-generation state.
const CANONICAL = Object.freeze({
  repository: CANONICAL_REPOSITORY,
  path: CANONICAL_PATH,
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

export type GeneratedArchiveRecord = {
  canonicalId: string;
  canonical: Record<string, unknown> & { id: string; date: string; title: string; comment: string; original?: string; url?: string };
  chronology: { archiveChronologyMarker: string; sortKey: string; hasVerifiedPublicationTimestamp: false };
};

export type GeneratedArchive =
  | { status: 'unavailable' }
  | { status: 'verified'; provenance: { repository: string; path: string; commit: string; sourceDigest: string; recordCount: number }; records: GeneratedArchiveRecord[] };

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
  // Permanent identity: repository and path are fixed architecture constants.
  if (value.repository !== CANONICAL.repository) fail(`${name} repository is not canonical`);
  if (value.path !== CANONICAL.path) fail(`${name} path is not canonical`);
  // Generation identity: commit + sourceDigest are OBSERVED PROVENANCE, not a
  // hardcoded generation pin (Stage 2A-P2R2 §6). The loader accepts any valid
  // generation; it refuses only malformed provenance form. The exact commit and
  // digest are validated for self-consistency below (snapshot == LORE_SOURCE,
  // record count, unique IDs, chronology) and — via media-reader-state — that
  // the derived manifests belong to this same generation.
  if (typeof value.commit !== 'string' || !FULL_SHA_RE.test(value.commit)) fail(`${name} commit provenance is malformed`);
  if (typeof value.sourceDigest !== 'string' || !SOURCE_DIGEST_RE.test(value.sourceDigest)) fail(`${name} source digest provenance is malformed`);
  if (!Number.isInteger(value.recordCount) || (value.recordCount as number) < 1) fail(`${name} record count is invalid`);
}

/** Reads only importer-generated artifacts; invalid present artifacts fail closed. */
export function loadGeneratedArchive(generatedDirectory = resolve(process.cwd(), 'generated')): GeneratedArchive {
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
  const records = snapshot.records.map((entry, index) => {
    const record = object(entry, `snapshot record ${index}`);
    if (typeof record.canonicalId !== 'string' || record.canonicalId.length === 0) fail(`snapshot record ${index} canonical ID is invalid`);
    const canonical = object(record.canonical, `snapshot record ${index} canonical payload`);
    if (canonical.id !== record.canonicalId) fail(`snapshot record ${index} rewrites canonical ID`);
    const chronology = object(record.chronology, `snapshot record ${index} chronology`);
    if (typeof canonical.date !== 'string' || typeof canonical.title !== 'string' || typeof canonical.comment !== 'string') fail(`snapshot record ${index} canonical fields are invalid`);
    if ((canonical.original !== undefined && typeof canonical.original !== 'string') || (canonical.url !== undefined && typeof canonical.url !== 'string')) fail(`snapshot record ${index} optional canonical fields are invalid`);
    if (chronology.archiveChronologyMarker !== canonical.date || typeof chronology.sortKey !== 'string' || chronology.hasVerifiedPublicationTimestamp !== false) fail(`snapshot record ${index} chronology is invalid`);
    return { canonicalId: record.canonicalId, canonical: canonical as GeneratedArchiveRecord['canonical'], chronology: chronology as GeneratedArchiveRecord['chronology'] };
  });
  if (new Set(records.map((record) => record.canonicalId)).size !== provenance.recordCount) fail('snapshot canonical IDs are not unique');

  return {
    status: 'verified',
    provenance: { repository: provenance.repository as string, path: provenance.path as string, commit: provenance.commit as string, sourceDigest: provenance.sourceDigest as string, recordCount: provenance.recordCount as number },
    records,
  };
}

/** Small cover projection of the shared generated archive. */
export function loadArchiveCoverState(generatedDirectory = resolve(process.cwd(), 'generated')): ArchiveCoverState {
  const archive = loadGeneratedArchive(generatedDirectory);
  if (archive.status === 'unavailable') return archive;
  return { status: 'verified', recordCount: archive.provenance.recordCount, canonicalCommit: archive.provenance.commit, repository: archive.provenance.repository, path: archive.provenance.path, sourceDigest: archive.provenance.sourceDigest };
}
