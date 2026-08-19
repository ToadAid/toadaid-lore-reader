/**
 * Generated legacy-media candidate manifest (Stage 2A-P2).
 *
 * This is the first DERIVED media layer. It is GENERATED, DERIVED,
 * PROVENANCE-BOUND, and NON-AUTHORITATIVE. It is never a second authored media
 * database. It describes the current truth only: "a canonical record contains
 * a legacy media reference." Nothing more.
 *
 * A legacy `img` reference is NOT yet a `HistoricalArtifact` (Stage 2A-P1): no
 * human has authored an `artifactId`, `expectedSha256`, `rightsStatus`, or
 * `archivePath` for it. Therefore candidates carry a deterministic INTERNAL
 * `candidateKey` that is NOT an `artifactId`, does NOT satisfy the canonical
 * artifact-id validator, is NOT Mirror-citable, and must never become permanent
 * artifact identity. If a future human admits the media canonically, that human
 * authors a real stable `artifactId` separately.
 */
import type { LoreSourceProvenance } from './provenance.ts';
import { isValidArtifactId } from './canonical-schema.ts';

/** Generated manifest schema identity (local to Reader; NOT the canonical lore
 *  schema version). */
export const LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION = '1.0.0';

/** The canonical field a legacy candidate is derived from. P2 handles `img`. */
export type LegacyMediaField = 'img';

/** Mechanically implied format category for a legacy `img` reference. */
export type LegacyMediaType = 'image';

/** Derived admission state for a legacy candidate. Always `REFERENCE_ONLY` in
 *  P2: a canonical media reference is present, but no canonical expected digest
 *  exists. This is derived solely from canonical import truth (no network). */
export type LegacyMediaCandidateState = 'REFERENCE_ONLY';

/** A single generated legacy-media candidate. Derived, not authored. */
export interface LegacyMediaCandidate {
  /** Deterministic internal generated key, form `legacy-img:<canonicalId>`.
   *  NOT an `artifactId`; not Mirror-citable; not permanent identity. */
  candidateKey: string;
  /** The canonical record that carries the legacy reference. */
  canonicalId: string;
  /** The canonical field the reference was read from. */
  legacyField: LegacyMediaField;
  /** The exact legacy value, preserved byte-for-byte. A legacy self-hosted
   *  media locator/reference — NOT a verified `sourceUrl` or `archivePath`. */
  legacyImgReference: string;
  /** Mechanically implied format category. */
  type: LegacyMediaType;
  /** Derived admission state. */
  state: LegacyMediaCandidateState;
}

/** Generated legacy-media candidate manifest, provenance-bound to the same
 *  canonical import generation as the Reader snapshot. */
export interface LegacyMediaCandidateManifest {
  schemaVersion: typeof LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION;
  provenance: LoreSourceProvenance;
  candidateCount: number;
  candidates: LegacyMediaCandidate[];
}

/** Snapshot record shape consumed by the builder (minimal projection of the
 *  real snapshot record). */
interface SnapshotRecord {
  canonicalId: string;
  canonical: { img?: string; [field: string]: unknown };
}

/** Minimal snapshot shape consumed by the validator. */
export interface CandidateManifestSnapshot {
  provenance: LoreSourceProvenance;
  records: SnapshotRecord[];
}

const CANDIDATE_KEY_PREFIX = 'legacy-img:';
const CANDIDATE_KEY_RE = /^legacy-img:[A-Za-z0-9_]+$/;

/** Canonical-artifact fields/preservation claims that must NEVER appear on a
 *  generated legacy candidate (they would blur authored vs derived and could
 *  imply preservation that no human has governed). */
const FORBIDDEN_CANDIDATE_FIELDS: ReadonlySet<string> = new Set([
  'artifactId',
  'expectedSha256',
  'archivePath',
  'rightsStatus',
  'rightsPosture',
  'attribution',
  'alt',
  'caption',
  'observedSha256',
  'mimeType',
  'byteSize',
  'width',
  'height',
  'duration',
  'admissionState',
  'effectiveOfflineEligible',
]);

function fail(message: string): never {
  throw new Error(`Legacy media candidate manifest refused: ${message}`);
}

function candidateKeyFor(canonicalId: string): string {
  return `${CANDIDATE_KEY_PREFIX}${canonicalId}`;
}

/**
 * Build a generated legacy-media candidate manifest from a Reader snapshot's
 * records and provenance. Deterministic: identical canonical bytes yield
 * identical candidate count, ordering, keys, and payload.
 *
 * Candidates follow the canonical snapshot ordering (chronological `sortKey`,
 * then `canonicalId`) of the supplied `records`; they are not sorted by URL.
 * A record with an empty/absent `img` produces no candidate. An archive with
 * zero non-empty `img` fields yields a valid zero-candidate manifest.
 */
export function buildLegacyMediaCandidateManifest(
  records: SnapshotRecord[],
  provenance: LoreSourceProvenance,
): LegacyMediaCandidateManifest {
  const candidates: LegacyMediaCandidate[] = [];
  for (const record of records) {
    const img = record.canonical?.img;
    if (typeof img !== 'string' || img.length === 0) continue;
    candidates.push({
      candidateKey: candidateKeyFor(record.canonicalId),
      canonicalId: record.canonicalId,
      legacyField: 'img',
      legacyImgReference: img,
      type: 'image',
      state: 'REFERENCE_ONLY',
    });
  }
  return {
    schemaVersion: LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION,
    provenance,
    candidateCount: candidates.length,
    candidates,
  };
}

/**
 * Validate a generated legacy-media candidate manifest against the Reader
 * snapshot of the SAME canonical import generation. Fails closed on any
 * invalidity, including any attempt to inject canonical-artifact identity,
 * preservation claims, or rights clearance into a derived candidate.
 */
export function validateLegacyMediaCandidateManifest(
  manifest: unknown,
  snapshot: CandidateManifestSnapshot,
): LegacyMediaCandidateManifest {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest is not an object');
  }
  const m = manifest as Record<string, unknown>;

  if (m.schemaVersion !== LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION) {
    fail(`schemaVersion must be '${LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION}'`);
  }

  // Provenance exact binding (same canonical generation as the snapshot).
  const p = m.provenance as Record<string, unknown> | undefined;
  const s = snapshot.provenance;
  if (!p || typeof p !== 'object') fail('provenance is missing');
  if (p.repository !== s.repository) fail('provenance repository mismatch');
  if (p.path !== s.path) fail('provenance path mismatch');
  if (p.commit !== s.commit) fail('provenance commit mismatch');
  if (p.sourceDigest !== s.sourceDigest) fail('provenance sourceDigest mismatch');
  if (p.recordCount !== s.recordCount) fail('provenance recordCount mismatch');

  if (!Array.isArray(m.candidates)) fail('candidates is not an array');
  const candidates = m.candidates as Record<string, unknown>[];
  if (typeof m.candidateCount !== 'number' || !Number.isInteger(m.candidateCount)) {
    fail('candidateCount is not an integer');
  }
  if (m.candidateCount !== candidates.length) fail('candidateCount does not match candidates.length');

  // Index snapshot records by canonicalId for existence + img-mismatch checks.
  const byId = new Map<string, string>();
  for (const r of snapshot.records) {
    byId.set(r.canonicalId, typeof r.canonical?.img === 'string' ? r.canonical.img : '');
  }

  const seenKeys = new Set<string>();
  const seenCanonicalIds = new Set<string>();

  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      fail(`candidate ${index} is not an object`);
    }
    for (const field of FORBIDDEN_CANDIDATE_FIELDS) {
      if (candidate[field] !== undefined) {
        fail(`candidate ${index} must not contain field '${field}'`);
      }
    }
    if (typeof candidate.candidateKey !== 'string' || !CANDIDATE_KEY_RE.test(candidate.candidateKey)) {
      fail(`candidate ${index} has an invalid candidateKey`);
    }
    // Identity separation: a candidate key must NOT be a canonical artifactId.
    if (isValidArtifactId(candidate.candidateKey)) {
      fail(`candidate ${index} candidateKey must not be a canonical artifactId`);
    }
    if (typeof candidate.canonicalId !== 'string' || candidate.canonicalId.length === 0) {
      fail(`candidate ${index} has an invalid canonicalId`);
    }
    if (candidate.legacyField !== 'img') fail(`candidate ${index} legacyField must be 'img'`);
    if (typeof candidate.legacyImgReference !== 'string' || candidate.legacyImgReference.length === 0) {
      fail(`candidate ${index} has an invalid legacyImgReference`);
    }
    if (candidate.type !== 'image') fail(`candidate ${index} type must be 'image'`);
    if (candidate.state !== 'REFERENCE_ONLY') fail(`candidate ${index} state must be 'REFERENCE_ONLY'`);

    if (seenKeys.has(candidate.candidateKey)) fail(`duplicate candidateKey ${candidate.candidateKey}`);
    seenKeys.add(candidate.candidateKey);
    if (seenCanonicalIds.has(candidate.canonicalId)) {
      fail(`duplicate canonicalId ${candidate.canonicalId}`);
    }
    seenCanonicalIds.add(candidate.canonicalId);

    const snapshotImg = byId.get(candidate.canonicalId);
    if (snapshotImg === undefined) {
      fail(`candidate ${index} canonicalId ${candidate.canonicalId} absent from snapshot`);
    }
    if (snapshotImg !== candidate.legacyImgReference) {
      fail(`candidate ${index} legacyImgReference does not match record.canonical.img`);
    }
  }

  return {
    schemaVersion: LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION,
    provenance: snapshot.provenance,
    candidateCount: candidates.length,
    candidates: candidates as unknown as LegacyMediaCandidate[],
  };
}