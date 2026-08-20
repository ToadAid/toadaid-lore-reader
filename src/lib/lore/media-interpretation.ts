// Deterministic legacy-media interpretation (Stage 2A-P2M1).
//
// This is a CLASSIFICATION-ONLY layer. It derives a media interpretation from
// canonical strings without changing the authored canonical lore schema and
// without any preservation, downloading, remote inspection, rendering, artifact
// admission, or canonical mutation.
//
// Core law: Unknown stays unknown. A reference is NEVER inferred to be an image
// merely because it came from the legacy field named `img`. Classification is
// derived only from deterministic, mechanically defensible signals:
//   - a trustworthy file extension on the URL path (after stripping query and
//     fragment), matched against an explicit, documented supported list; or
//   - a mechanically recognized YouTube URL form (by host + path shape).
//
// Naming choice: classification kinds use UPPER_SNAKE (`IMAGE`, `VIDEO`,
// `AUDIO`, `YOUTUBE`, `UNKNOWN_REFERENCE`). This deliberately follows the
// repository's existing state/category convention (`ArtifactAdmissionState`:
// `REFERENCE_ONLY`, `PRESERVED_VERIFIED`, …) and is distinct from the lowercase
// media-FORMAT axis (`ArtifactType`: `image`, `video`, `audio`, `document`) and
// from the sealed P2 candidate's `type: 'image'` field. A classification is a
// derived category of a reference, NOT a media format type and NOT a
// preservation/admission state. The exposed field is named `kind` to avoid any
// collision with the sealed candidate `type`.
//
// media type != preservation state: `IMAGE` does NOT mean `PRESERVED_VERIFIED`.
// No rights, archive, digest, or availability is inferred from any
// classification. (See docs/historical-artifact-contract.md for the governed
// admission contract this layer deliberately does not touch.)
//
// This module performs NO I/O, NO network access, NO filesystem access. It is a
// pure function over canonical strings.

import type { LoreSourceProvenance } from './provenance.ts';

/** Derived media-reference classification category. */
export type MediaClassificationKind =
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'YOUTUBE'
  | 'UNKNOWN_REFERENCE';

/** A single deterministic media classification of one reference string. */
export interface MediaClassification {
  /** Derived classification category (NOT a format type, NOT an admission state). */
  kind: MediaClassificationKind;
  /** The exact reference string classified, preserved byte-for-byte. */
  reference: string;
}

/**
 * Supported image extensions (lowercase). Case-insensitive at match time.
 * Documented, explicit list — no speculative formats.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif',
]);

/** Supported direct-video extensions (lowercase). */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'webm', 'mov',
]);

/** Supported direct-audio extensions (lowercase). */
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3', 'm4a', 'wav', 'ogg',
]);

/** Hosts recognized as YouTube (lowercase; URL.hostname is already lowercased). */
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
]);
const YOUTUBE_SHORT_HOST = 'youtu.be';

/**
 * Parse a reference as an absolute URL, or return null if it is not a parseable
 * absolute URL. `new URL` rejects non-URL / relative input without a base, which
 * gives fail-closed behavior: unparseable references become UNKNOWN_REFERENCE.
 */
function tryParseUrl(reference: string): URL | null {
  try {
    return new URL(reference);
  } catch {
    return null;
  }
}

/**
 * Return the file extension of the final path segment of a URL pathname, or null
 * when there is no trustworthy extension signal. Query strings and fragments
 * are excluded by construction (URL.pathname never includes them), so a `.jpg`
 * that appears only inside a query parameter or fragment cannot classify.
 *
 * A leading-dot segment (`.jpg`) and a trailing-dot segment (`file.`) both
 * yield null — there is no real basename/extension pair.
 */
function pathExtension(pathname: string): string | null {
  const segment = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (segment.length === 0) return null;
  const dot = segment.lastIndexOf('.');
  if (dot <= 0 || dot === segment.length - 1) return null;
  return segment.slice(dot + 1);
}

/**
 * True when `url` is a mechanically recognized YouTube form:
 *   - `youtu.be/<video-id>` (non-empty path beyond '/')
 *   - `youtube.com` / `www.youtube.com` / `m.youtube.com` with path `/watch`,
 *     `/embed/<id>`, or `/shorts/<id>`
 *
 * These are unambiguous YouTube surfaces. Other youtube.com paths are NOT
 * claimed as YouTube (they fall through to extension/UNKNOWN).
 */
function isYouTube(url: URL): boolean {
  const host = url.hostname;
  if (host === YOUTUBE_SHORT_HOST) {
    return url.pathname.length > 1 && url.pathname !== '/';
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const path = url.pathname;
    return path === '/watch' || path.startsWith('/embed/') || path.startsWith('/shorts/');
  }
  return false;
}

/**
 * Classify a single media-reference string. Returns null for an empty/absent
 * reference (no classification); otherwise a classification whose `kind` may be
 * `UNKNOWN_REFERENCE` when no deterministic rule proves a recognized kind.
 *
 * Deterministic and pure: no I/O, no network. YouTube is checked before the
 * extension so a YouTube URL is claimed as `YOUTUBE` regardless of any extension
 * in its query string.
 */
export function classifyMediaReference(reference: string): MediaClassification | null {
  if (typeof reference !== 'string' || reference.length === 0) return null;
  const url = tryParseUrl(reference);
  if (url === null) {
    return { kind: 'UNKNOWN_REFERENCE', reference };
  }
  if (isYouTube(url)) {
    return { kind: 'YOUTUBE', reference };
  }
  const ext = pathExtension(url.pathname);
  if (ext !== null) {
    const lower = ext.toLowerCase();
    if (IMAGE_EXTENSIONS.has(lower)) return { kind: 'IMAGE', reference };
    if (VIDEO_EXTENSIONS.has(lower)) return { kind: 'VIDEO', reference };
    if (AUDIO_EXTENSIONS.has(lower)) return { kind: 'AUDIO', reference };
  }
  return { kind: 'UNKNOWN_REFERENCE', reference };
}

// ---------------------------------------------------------------------------
// `original` markdown / text interpretation.
//
// The canonical `original` field is authored markdown that may contain
// mechanically recognizable media links (e.g. YouTube URLs, or markdown
// image/video embeds). This extracts URL tokens with a bounded, non-executing
// regex (no markdown engine, no HTML, no browser) and classifies each.
//
// Multiplicity is represented honestly as a bounded collection in document
// (first-occurrence) order. Ordinary non-media links (e.g. a blog post URL)
// classify as UNKNOWN_REFERENCE and are NOT emitted — an ordinary link is not a
// media reference. Only recognized media references (IMAGE/VIDEO/AUDIO/YOUTUBE)
// are returned, in the order they first appear. This is the opposite of
// guessing: it refuses to call a normal link "media".
// ---------------------------------------------------------------------------

/** Bounded URL-token extractor: http(s) URLs, stopping at whitespace and common
 *  markdown/HTML delimiters. Captures the URL inside `[text](URL)`, `![alt](URL)`,
 *  autolinks `<URL>`, and bare prose URLs. Does not execute markdown or HTML. */
const URL_TOKEN_RE = /https?:\/\/[^\s"'()<>\[\]]+/gi;

/** A recognized media reference discovered within `original`, with its
 *  0-based occurrence index among the recognized references (document order). */
export interface OriginalMediaReference {
  classification: MediaClassification;
  occurrenceIndex: number;
}

/**
 * Extract recognized media references from `original` markdown/text. Returns
 * only IMAGE/VIDEO/AUDIO/YOUTUBE references, in first-occurrence order, each
 * with a stable `occurrenceIndex` (0-based among the recognized set). Empty or
 * non-string input yields an empty array. Pure; no I/O, no network.
 */
export function interpretOriginalMedia(original: string): OriginalMediaReference[] {
  if (typeof original !== 'string' || original.length === 0) return [];
  const results: OriginalMediaReference[] = [];
  let recognized = 0;
  for (const match of original.matchAll(URL_TOKEN_RE)) {
    const token = match[0];
    const classification = classifyMediaReference(token);
    if (classification !== null && classification.kind !== 'UNKNOWN_REFERENCE') {
      results.push({ classification, occurrenceIndex: recognized });
      recognized += 1;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Generated media-interpretation manifest (Stage 2A-P2M1).
//
// This is a SEPARATE DERIVED layer from the sealed Stage 2A-P2 candidate
// manifest. The candidate manifest is unchanged: a legacy `img` still produces
// a `REFERENCE_ONLY` candidate of `type: 'image'`. This manifest adds the new
// interpretation behavior in its own structure, provenance-bound to the same
// canonical generation, WITHOUT converting candidates into governed
// HistoricalArtifact objects and WITHOUT minting artifactId / expectedSha256 /
// archivePath / admission state. It is classification only.
// ---------------------------------------------------------------------------

/** Generated media-interpretation manifest schema identity (local to Reader). */
export const MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION = '1.0.0';

/** All classification kinds, in a stable order for counts. */
export const MEDIA_CLASSIFICATION_KINDS: readonly MediaClassificationKind[] = [
  'IMAGE', 'VIDEO', 'AUDIO', 'YOUTUBE', 'UNKNOWN_REFERENCE',
];

/** Per-record derived media interpretation. */
export interface RecordMediaInterpretation {
  /** The canonical record this interpretation is derived from. */
  canonicalId: string;
  /** Classification of the legacy `img` field, when non-empty. Absent when the
   *  record has no non-empty legacy `img`. May be `UNKNOWN_REFERENCE`. */
  imgClassification?: MediaClassification;
  /** Recognized media references (IMAGE/VIDEO/AUDIO/YOUTUBE) found in
   *  `original`, in first-occurrence order. Empty when `original` has none. */
  originalReferences: OriginalMediaReference[];
}

/** Generated, provenance-bound media-interpretation manifest. Derived, not
 *  authored; never authoritative; never a second lore database. */
export interface MediaInterpretationManifest {
  schemaVersion: typeof MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION;
  provenance: LoreSourceProvenance;
  /** Number of records with at least one media reference (a non-empty legacy
   *  `img` of any kind, or a recognized `original` reference). */
  interpretedRecordCount: number;
  /** Total media references counted (every non-empty `img` of any kind plus
   *  every recognized `original` reference). */
  referenceCount: number;
  /** Counts per classification kind. The sum across all kinds equals
   *  `referenceCount`. */
  counts: Record<MediaClassificationKind, number>;
  interpretations: RecordMediaInterpretation[];
}

/** Minimal snapshot shape consumed by the builder and validator. */
interface InterpretationSnapshotRecord {
  canonicalId: string;
  canonical: { img?: string; original?: string; [field: string]: unknown };
}
export interface InterpretationManifestSnapshot {
  provenance: LoreSourceProvenance;
  records: InterpretationSnapshotRecord[];
}

/** Authored/artifact/preservation fields that must NEVER appear on a derived
 *  interpretation (they would blur authored vs derived and could imply
 *  preservation no human has governed). */
const FORBIDDEN_INTERPRETATION_FIELDS: ReadonlySet<string> = new Set([
  'artifactId', 'expectedSha256', 'archivePath', 'rightsStatus', 'rightsPosture',
  'attribution', 'alt', 'caption', 'observedSha256', 'mimeType', 'byteSize',
  'width', 'height', 'duration', 'admissionState', 'effectiveOfflineEligible',
]);

function manifestFail(message: string): never {
  throw new Error(`Media interpretation manifest refused: ${message}`);
}

function emptyCounts(): Record<MediaClassificationKind, number> {
  return { IMAGE: 0, VIDEO: 0, AUDIO: 0, YOUTUBE: 0, UNKNOWN_REFERENCE: 0 };
}

function assertClassification(value: unknown, where: string): MediaClassification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    manifestFail(`${where} is not an object`);
  }
  const c = value as Record<string, unknown>;
  for (const field of FORBIDDEN_INTERPRETATION_FIELDS) {
    if (c[field] !== undefined) manifestFail(`${where} must not contain field '${field}'`);
  }
  if (typeof c.kind !== 'string' || !MEDIA_CLASSIFICATION_KINDS.includes(c.kind as MediaClassificationKind)) {
    manifestFail(`${where} has an invalid kind`);
  }
  if (typeof c.reference !== 'string' || c.reference.length === 0) {
    manifestFail(`${where} has an invalid reference`);
  }
  return { kind: c.kind as MediaClassificationKind, reference: c.reference };
}

/**
 * Strict deep equality used to prove the supplied manifest is the EXACT
 * deterministic derivation of the snapshot, not merely internally consistent.
 * Catches kind swaps, occurrence-index changes, reordering, omissions,
 * duplicates, injected references, and aggregate-count drift that the
 * plausibility checks above cannot. Own-key order is irrelevant (objects are
 * compared by key membership and value); array order is significant.
 */
function deepStrictEqual(a: unknown, b: unknown, path: string): void {
  if (Object.is(a, b)) return;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    manifestFail(`manifest does not equal deterministic derivation at ${path}`);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      manifestFail(`manifest does not equal deterministic derivation at ${path} (array length/order)`);
    }
    for (let i = 0; i < a.length; i += 1) {
      deepStrictEqual((a as unknown[])[i], (b as unknown[])[i], `${path}[${i}]`);
    }
    return;
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) {
    manifestFail(`manifest does not equal deterministic derivation at ${path} (field set)`);
  }
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) {
      manifestFail(`manifest does not equal deterministic derivation at ${path} (unexpected field '${k}')`);
    }
    deepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
  }
}

/**
 * Build a generated media-interpretation manifest from a Reader snapshot's
 * records and provenance. Deterministic: identical canonical bytes yield
 * identical interpretations, counts, and ordering.
 *
 * Only records that carry at least one media reference (a non-empty legacy
 * `img`, or a recognized `original` reference) appear in `interpretations`,
 * following the snapshot's chronological order. No network, no fetching, no
 * preservation: derived solely from the canonical strings.
 */
export function buildMediaInterpretationManifest(
  records: InterpretationSnapshotRecord[],
  provenance: LoreSourceProvenance,
): MediaInterpretationManifest {
  const counts = emptyCounts();
  const interpretations: RecordMediaInterpretation[] = [];
  let referenceCount = 0;
  for (const record of records) {
    const canonical = record.canonical ?? {};
    const img = typeof canonical.img === 'string' ? canonical.img : '';
    const imgClassification = img.length > 0 ? classifyMediaReference(img) : null;
    if (imgClassification) counts[imgClassification.kind] += 1;
    const original = typeof canonical.original === 'string' ? canonical.original : '';
    const originalReferences = interpretOriginalMedia(original);
    for (const ref of originalReferences) counts[ref.classification.kind] += 1;
    if (imgClassification === null && originalReferences.length === 0) continue;
    referenceCount += (imgClassification ? 1 : 0) + originalReferences.length;
    const entry: RecordMediaInterpretation = {
      canonicalId: record.canonicalId,
      originalReferences,
    };
    if (imgClassification) entry.imgClassification = imgClassification;
    interpretations.push(entry);
  }
  return {
    schemaVersion: MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION,
    provenance,
    interpretedRecordCount: interpretations.length,
    referenceCount,
    counts,
    interpretations,
  };
}

/**
 * Validate a generated media-interpretation manifest against the Reader
 * snapshot of the SAME canonical import generation. Fails closed on any
 * invalidity, including any attempt to inject artifact identity, preservation
 * claims, or rights clearance, and including provenance drift from the
 * snapshot's generation.
 */
export function validateMediaInterpretationManifest(
  manifest: unknown,
  snapshot: InterpretationManifestSnapshot,
): MediaInterpretationManifest {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    manifestFail('manifest is not an object');
  }
  const m = manifest as Record<string, unknown>;

  if (m.schemaVersion !== MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION) {
    manifestFail(`schemaVersion must be '${MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION}'`);
  }

  // Provenance exact binding (same canonical generation as the snapshot).
  const p = m.provenance as Record<string, unknown> | undefined;
  const s = snapshot.provenance;
  if (!p || typeof p !== 'object') manifestFail('provenance is missing');
  if (p.repository !== s.repository) manifestFail('provenance repository mismatch');
  if (p.path !== s.path) manifestFail('provenance path mismatch');
  if (p.commit !== s.commit) manifestFail('provenance commit mismatch');
  if (p.sourceDigest !== s.sourceDigest) manifestFail('provenance sourceDigest mismatch');
  if (p.recordCount !== s.recordCount) manifestFail('provenance recordCount mismatch');

  const counts = m.counts as Record<string, unknown> | undefined;
  if (!counts || typeof counts !== 'object') manifestFail('counts is missing');
  let countedTotal = 0;
  for (const kind of MEDIA_CLASSIFICATION_KINDS) {
    const value = (counts as Record<string, unknown>)[kind];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      manifestFail(`counts.${kind} is not a non-negative integer`);
    }
    countedTotal += value as number;
  }
  for (const key of Object.keys(counts)) {
    if (!MEDIA_CLASSIFICATION_KINDS.includes(key as MediaClassificationKind)) {
      manifestFail(`counts has unexpected key '${key}'`);
    }
  }
  if (typeof m.referenceCount !== 'number' || !Number.isInteger(m.referenceCount)) {
    manifestFail('referenceCount is not an integer');
  }
  if (m.referenceCount !== countedTotal) manifestFail('referenceCount does not equal sum of counts');
  if (typeof m.interpretedRecordCount !== 'number' || !Number.isInteger(m.interpretedRecordCount)) {
    manifestFail('interpretedRecordCount is not an integer');
  }
  if (!Array.isArray(m.interpretations)) manifestFail('interpretations is not an array');
  if (m.interpretedRecordCount !== (m.interpretations as unknown[]).length) {
    manifestFail('interpretedRecordCount does not match interpretations.length');
  }

  // Index snapshot records by canonicalId + their canonical strings.
  const byId = new Map<string, { img: string; original: string }>();
  for (const r of snapshot.records) {
    byId.set(r.canonicalId, {
      img: typeof r.canonical?.img === 'string' ? r.canonical.img : '',
      original: typeof r.canonical?.original === 'string' ? r.canonical.original : '',
    });
  }

  const seenIds = new Set<string>();
  for (const [index, entry] of (m.interpretations as Record<string, unknown>[]).entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      manifestFail(`interpretation ${index} is not an object`);
    }
    for (const field of FORBIDDEN_INTERPRETATION_FIELDS) {
      if (entry[field] !== undefined) manifestFail(`interpretation ${index} must not contain field '${field}'`);
    }
    if (typeof entry.canonicalId !== 'string' || entry.canonicalId.length === 0) {
      manifestFail(`interpretation ${index} has an invalid canonicalId`);
    }
    if (seenIds.has(entry.canonicalId)) manifestFail(`duplicate canonicalId ${entry.canonicalId}`);
    seenIds.add(entry.canonicalId);
    const snap = byId.get(entry.canonicalId);
    if (!snap) manifestFail(`interpretation ${index} canonicalId ${entry.canonicalId} absent from snapshot`);

    // imgClassification, when present, must exactly match a re-derivation from
    // the snapshot's legacy `img` (no independent bytes allowed).
    if (entry.imgClassification !== undefined) {
      const ic = assertClassification(entry.imgClassification, `interpretation ${index} imgClassification`);
      const expected = classifyMediaReference(snap.img);
      if (!expected || expected.kind !== ic.kind || expected.reference !== ic.reference) {
        manifestFail(`interpretation ${index} imgClassification does not match snapshot img`);
      }
    } else if (snap.img.length > 0) {
      manifestFail(`interpretation ${index} is missing imgClassification for a non-empty img`);
    }

    if (!Array.isArray(entry.originalReferences)) manifestFail(`interpretation ${index} originalReferences is not an array`);
    for (const [j, ref] of (entry.originalReferences as Record<string, unknown>[]).entries()) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
        manifestFail(`interpretation ${index} originalReferences[${j}] is not an object`);
      }
      // Forbidden preservation/artifact fields must not appear on the wrapper
      // either (only `classification` and `occurrenceIndex` are permitted here).
      for (const field of FORBIDDEN_INTERPRETATION_FIELDS) {
        if ((ref as Record<string, unknown>)[field] !== undefined) {
          manifestFail(`interpretation ${index} originalReferences[${j}] must not contain field '${field}'`);
        }
      }
      const c = assertClassification((ref as Record<string, unknown>)?.classification, `interpretation ${index} originalReferences[${j}].classification`);
      // original references must be recognized kinds (never UNKNOWN_REFERENCE)
      if (c.kind === 'UNKNOWN_REFERENCE') {
        manifestFail(`interpretation ${index} originalReferences[${j}] must be a recognized kind`);
      }
      if (typeof (ref as Record<string, unknown>).occurrenceIndex !== 'number' || !Number.isInteger((ref as Record<string, unknown>).occurrenceIndex)) {
        manifestFail(`interpretation ${index} originalReferences[${j}].occurrenceIndex is not an integer`);
      }
      // The reference must actually occur within the snapshot's original text.
      if (!snap.original.includes(c.reference)) {
        manifestFail(`interpretation ${index} originalReferences[${j}].reference not found in snapshot original`);
      }
    }
  }

  // Final authoritative gate: re-derive the EXACT expected media interpretation
  // deterministically from the snapshot (one source of derivation truth — the
  // same builder used to author the manifest) and require the supplied manifest
  // to be strictly, semantically equal to it. The snapshot is authority; the
  // manifest is derived output. This refuses any mutation the plausibility
  // checks above cannot catch: kind swaps, occurrence-index changes, reordered
  // /omitted/duplicated/injected original references, and aggregate counts that
  // are internally consistent but wrong. It also re-confirms exact per-kind
  // counts, referenceCount, interpretedRecordCount, provenance, and which
  // records appear (and in which order) — all against canonical derivation.
  const expected = buildMediaInterpretationManifest(snapshot.records, snapshot.provenance);
  deepStrictEqual(m, expected, 'manifest');

  return {
    schemaVersion: MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION,
    provenance: snapshot.provenance,
    interpretedRecordCount: m.interpretedRecordCount as number,
    referenceCount: m.referenceCount as number,
    counts: counts as Record<MediaClassificationKind, number>,
    interpretations: m.interpretations as RecordMediaInterpretation[],
  };
}