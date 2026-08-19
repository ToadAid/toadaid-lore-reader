/** Canonical archive fields are retained without interpretation or repair. */
export interface CanonicalLoreRecord {
  id: string;
  date: string;
  title: string;
  comment: string;
  original?: string;
  url?: string;
  img?: string;
  tags?: string;
  [field: string]: unknown;
}

// ---------------------------------------------------------------------------
// Historical artifact contract (Stage 2A-P1)
//
// ToadAid/toadaid.github.io/lore/data.json remains the ONE canonical authored
// lore-record source. Historical media binaries may later exist as immutable
// companion evidence, but they do NOT become an independently authored lore
// database. The contract below is governed authored metadata that identifies
// media as historical evidence; it does NOT prove bytes exist, are
// rights-cleared, or are safe for offline use.
//
// The previously-scaffolded `MediaReference` interface was superseded: it
// collapsed the citation URL and the archival locator into one loose `source`
// field, mixed media format with evidential role in one `kind` enum, and had
// no artifact identity or governed digest. Repository search proved it was
// never imported by any implementation.
// ---------------------------------------------------------------------------

/** Media format axis — distinct from evidential role. */
export type ArtifactType = 'image' | 'video' | 'audio' | 'document';

/** Evidential role axis — distinct from media format. */
export type ArtifactRole =
  | 'original-post-media'
  | 'supporting-evidence'
  | 'screenshot'
  | 'contract-evidence'
  | 'historical-page';

/** Rights posture. The default architectural posture is `unknown`; public
 *  availability is never treated as rights clearance. */
export type ArtifactRightsStatus = 'unknown' | 'cleared' | 'restricted' | 'public-domain';

/** Governed canonical expected preservation digest.
 *  Format: `sha256:<64 lowercase hex>`, matching the provenance digest shape.
 *  This is authored canonical metadata — a generated manifest may copy and
 *  verify it but must never invent it (a mutable URL could serve different
 *  bytes across builds; only a governed expected digest makes preservation
 *  provable). */
export type ArtifactDigest = `sha256:${string}`;

/**
 * Authored canonical historical-artifact reference.
 *
 * Governed metadata authored alongside canonical lore. It is NOT a derived
 * manifest entry and NOT a runtime cache record.
 *
 * Permanent identity (`artifactId`) is explicitly authored, immutable after
 * canonical admission, and independent of array order, URL, and content
 * digest. A non-empty legacy `img` field is NOT this contract: it means only
 * "canonical media reference exists" and may never become an artifactId,
 * Mirror citation identity, or permanent historical identity.
 */
export interface HistoricalArtifact {
  /** Stable, archive-wide-unique, human-authored identity.
   *  Grammar: `<canonicalRecordId>_MEDIA_<slug>` (see `isValidArtifactId`). */
  artifactId: string;
  /** Media format axis. */
  type: ArtifactType;
  /** Evidential role axis. */
  role: ArtifactRole;
  /** Historical/original evidence location (the cited origin), e.g. an
   *  original Toadgod post. Distinct from `archivePath`. */
  sourceUrl: string;
  /** Archival locator under governed custody, e.g. `assets/lore/example.jpg`.
   *  Where an admitted preserved copy is stored. Absent when no preserved copy
   *  is admitted. Distinct from `sourceUrl`. */
  archivePath?: string;
  /** Governed canonical expected preservation digest. Present implies a
   *  preservation claim. Absent implies REFERENCE_ONLY (no preserved-binary
   *  claim). */
  expectedSha256?: ArtifactDigest;
  /** Rights posture. Required to force explicit authoring; `unknown` is the
   *  fail-closed default, not a permissive one. */
  rightsStatus: ArtifactRightsStatus;
  /** Optional human-authored credit. */
  attribution?: string;
  /** Optional alternative-text description (authored, not derived). */
  alt?: string;
  /** Optional human-authored caption. */
  caption?: string;
}

// ---------------------------------------------------------------------------
// Derived (non-canonical) artifact facts.
//
// These are mechanically measured or runtime-computed. They are NEVER authored
// canonical metadata and must not appear in authored artifact entries. The
// authored-contract validator below rejects them on input.
// ---------------------------------------------------------------------------

/** Mechanically measurable metadata, computed at admission/build time. */
export interface ArtifactDerivedMetadata {
  observedSha256?: ArtifactDigest;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  duration?: number;
}

/** Derived admission state. No path to `PRESERVED_VERIFIED` exists without a
 *  governed expected digest matching observed bytes exactly. */
export type ArtifactAdmissionState =
  | 'REFERENCE_ONLY'
  | 'PRESERVED_VERIFIED'
  | 'MISSING'
  | 'DIGEST_MISMATCH'
  | 'RIGHTS_NOT_ADMITTED'
  | 'UNSUPPORTED_MEDIA';

/** Effective offline eligibility is DERIVED from rights + admission + policy,
 *  never authored as an unconditional boolean that may contradict rights. */
export interface ArtifactAdmission {
  state: ArtifactAdmissionState;
  effectiveOfflineEligible: boolean;
}

/** Observed-bytes input to the pure admission-state derivation. Runtime-only;
 *  never authored. */
export interface ArtifactObservation {
  /** Whether preserved bytes are available to inspect. */
  available: boolean;
  /** Observed digest of available bytes, when computable. */
  observedSha256?: ArtifactDigest;
  /** Whether the media type is one the reader can handle. */
  supportedType?: boolean;
}

// ---------------------------------------------------------------------------
// Validation — fail closed on any invalidity.
// ---------------------------------------------------------------------------

const ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set(['image', 'video', 'audio', 'document']);
const ARTIFACT_ROLES: ReadonlySet<ArtifactRole> = new Set([
  'original-post-media',
  'supporting-evidence',
  'screenshot',
  'contract-evidence',
  'historical-page',
]);
const RIGHTS_STATUSES: ReadonlySet<ArtifactRightsStatus> = new Set([
  'unknown',
  'cleared',
  'restricted',
  'public-domain',
]);

const ARTIFACT_ID_SEPARATOR = '_MEDIA_';
const RECORD_ID_RE = /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;
const CONTROL_RE = /[\u0000-\u001f]/;

/** Derived/runtime fields that must never appear in an authored contract. */
const FORBIDDEN_AUTHORED_FIELDS: ReadonlySet<string> = new Set([
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
  throw new Error(`Historical artifact contract refused: ${message}`);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** True when `id` is a valid explicitly-authored artifact identity.
 *
 * Grammar: `<canonicalRecordId>_MEDIA_<slug>` where
 * - `<canonicalRecordId>` is at least two underscore-separated segments of
 *   `[A-Za-z0-9]+` (matching observed canonical IDs like
 *   `TOBY_T1201_TheValidatorAwakening`);
 * - exactly one `_MEDIA_` separator is present;
 * - `<slug>` is a non-empty human-authored stable string of `[A-Za-z0-9-]`
 *   that is NOT pure digits (a pure-integer slug is ordinal identity, which is
 *   rejected).
 *
 * Identity is independent of array order, URL, and content digest. */
export function isValidArtifactId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const first = id.indexOf(ARTIFACT_ID_SEPARATOR);
  if (first < 0) return false;
  if (id.indexOf(ARTIFACT_ID_SEPARATOR, first + ARTIFACT_ID_SEPARATOR.length) >= 0) return false;
  const recordId = id.slice(0, first);
  const slug = id.slice(first + ARTIFACT_ID_SEPARATOR.length);
  if (!RECORD_ID_RE.test(recordId)) return false;
  if (!SLUG_RE.test(slug)) return false;
  if (/^[0-9]+$/.test(slug)) return false; // reject ordinal/index identity
  return true;
}

/** True when `digest` is exactly `sha256:<64 lowercase hex>`. */
export function isValidArtifactDigest(digest: unknown): digest is ArtifactDigest {
  return typeof digest === 'string' && DIGEST_RE.test(digest);
}

export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && ARTIFACT_TYPES.has(value as ArtifactType);
}

export function isArtifactRole(value: unknown): value is ArtifactRole {
  return typeof value === 'string' && ARTIFACT_ROLES.has(value as ArtifactRole);
}

export function isArtifactRightsStatus(value: unknown): value is ArtifactRightsStatus {
  return typeof value === 'string' && RIGHTS_STATUSES.has(value as ArtifactRightsStatus);
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && URL_RE.test(value) && !CONTROL_RE.test(value);
}

function isArchivePath(value: unknown): value is string {
  // A relative, posix-style archival locator under governed custody. No drive
  // letters, no absolute paths, no backslashes, no control chars, non-empty.
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[\\]/.test(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.startsWith('/') &&
    !CONTROL_RE.test(value)
  );
}

/** Validate and return a narrow, typed authored artifact contract.
 *
 * Throws (fails closed) on any invalidity, including on the presence of any
 * derived/runtime field — enforcing the boundary between authored canonical
 * metadata and mechanically/runtime-derived facts. */
export function validateHistoricalArtifact(input: unknown): HistoricalArtifact {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('artifact is not an object');
  }
  const a = input as Record<string, unknown>;

  for (const field of FORBIDDEN_AUTHORED_FIELDS) {
    if (a[field] !== undefined) {
      fail(`authored contract must not contain derived/runtime field '${field}'`);
    }
  }

  if (!isValidArtifactId(a.artifactId)) {
    fail(`artifactId is not a valid explicitly-authored identity: ${show(a.artifactId)}`);
  }
  if (!isArtifactType(a.type)) {
    fail(`type is not one of image|video|audio|document: ${show(a.type)}`);
  }
  if (!isArtifactRole(a.role)) {
    fail(`role is not one of original-post-media|supporting-evidence|screenshot|contract-evidence|historical-page: ${show(a.role)}`);
  }
  if (!isHttpUrl(a.sourceUrl)) {
    fail(`sourceUrl is not an http/https URL: ${show(a.sourceUrl)}`);
  }
  if (a.archivePath !== undefined && !isArchivePath(a.archivePath)) {
    fail(`archivePath must be a relative posix-style locator: ${show(a.archivePath)}`);
  }
  if (a.expectedSha256 !== undefined && !isValidArtifactDigest(a.expectedSha256)) {
    fail(`expectedSha256 must be 'sha256:<64 lowercase hex>' or absent: ${show(a.expectedSha256)}`);
  }
  if (!isArtifactRightsStatus(a.rightsStatus)) {
    fail(`rightsStatus must be one of unknown|cleared|restricted|public-domain: ${show(a.rightsStatus)}`);
  }
  for (const field of ['attribution', 'alt', 'caption'] as const) {
    if (a[field] !== undefined && typeof a[field] !== 'string') {
      fail(`${field} must be a string if present: ${show(a[field])}`);
    }
  }

  const result: HistoricalArtifact = {
    artifactId: a.artifactId,
    type: a.type,
    role: a.role,
    sourceUrl: a.sourceUrl,
    rightsStatus: a.rightsStatus,
  };
  if (a.archivePath !== undefined) result.archivePath = a.archivePath;
  if (a.expectedSha256 !== undefined) result.expectedSha256 = a.expectedSha256;
  if (a.attribution !== undefined) result.attribution = a.attribution;
  if (a.alt !== undefined) result.alt = a.alt;
  if (a.caption !== undefined) result.caption = a.caption;
  return result;
}

/** Pure admission-state derivation from authored facts + an optional runtime
 *  observation. No network, no file lookup.
 *
 * Semantics (governor digest law):
 * - expectedSha256 absent                         -> REFERENCE_ONLY
 * - expectedSha256 present, rights not admitted   -> RIGHTS_NOT_ADMITTED
 * - expectedSha256 present, bytes unavailable     -> MISSING
 * - bytes present but type unsupported            -> UNSUPPORTED_MEDIA
 * - bytes present but digest != expected          -> DIGEST_MISMATCH
 * - bytes present and digest === expected         -> PRESERVED_VERIFIED
 *
 * No other path may claim preservation success. */
export function deriveAdmissionState(
  artifact: HistoricalArtifact,
  observed?: ArtifactObservation,
): ArtifactAdmissionState {
  if (artifact.expectedSha256 === undefined) return 'REFERENCE_ONLY';
  if (artifact.rightsStatus === 'unknown' || artifact.rightsStatus === 'restricted') {
    return 'RIGHTS_NOT_ADMITTED';
  }
  if (observed === undefined || !observed.available) return 'MISSING';
  if (observed.supportedType === false) return 'UNSUPPORTED_MEDIA';
  if (observed.observedSha256 === undefined || observed.observedSha256 !== artifact.expectedSha256) {
    return 'DIGEST_MISMATCH';
  }
  return 'PRESERVED_VERIFIED';
}