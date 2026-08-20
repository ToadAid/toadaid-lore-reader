// Stage 2A-P2M2 — media-aware Reader rendering state.
//
// This is a READER-RENDERING projection over the ALREADY-CLASSIFIED, provenance-
// bound media-interpretation manifest produced by the sealed Stage 2A-P2M1 layer
// (src/lib/lore/media-interpretation.ts). It does two things and nothing more:
//
//   1. LOAD + BIND: read the generated media-interpretation.json and prove it
//      belongs to the EXACT same generation as the generated reader snapshot, by
//      reusing the sealed P2M1 validator (validateMediaInterpretationManifest).
//      When no generated archive exists, return an unavailable state so the
//      clean-checkout build still succeeds. When a generated snapshot IS present
//      but the interpretation is missing / invalid JSON / wrong generation / not
//      the exact deterministic derivation, FAIL CLOSED (throw) rather than render
//      a partially trusted media state.
//
//   2. PROJECT: turn ALREADY-CLASSIFIED references into SAFE render descriptors.
//      Classification (P2M1) and rendering eligibility (P2M2) are different axes:
//      an IMAGE classified over HTTP renders as a link only, never as inline
//      media. Inline media is HTTPS-only; external reference links are HTTP(S)
//      only; everything else is non-clickable text. YouTube is click-to-load via
//      a privacy-conscious nocookie embed, with a deterministic video ID derived
//      mechanically from recognized forms (never guessed).
//
// This module performs NO network access and NO media fetching at build time. It
// does NOT re-classify canonical strings (it trusts the manifest's `kind`), and
// it does NOT invent artifactId / expectedSha256 / archivePath / rights /
// admission / preservation state. A displayed remote asset is a historical
// external media reference, never a preserved artifact. See
// docs/historical-artifact-contract.md for the governed admission contract this
// layer deliberately does not touch.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateMediaInterpretationManifest,
  type MediaClassificationKind,
  type MediaClassification,
  type RecordMediaInterpretation,
  type InterpretationManifestSnapshot,
} from './media-interpretation.ts';
import type { LoreSourceProvenance } from './provenance.ts';

// ---------------------------------------------------------------------------
// URL safety + YouTube projection (pure; no I/O, no network).
// ---------------------------------------------------------------------------

function tryParseUrl(reference: string): URL | null {
  try {
    return new URL(reference);
  } catch {
    return null;
  }
}

/** True when `reference` is an absolute http(s) URL — eligible to be an
 *  external reference link. Everything else (javascript:, data:, file:, bare
 *  text, unparseable) is refused for active linking. */
export function isSafeExternalHref(reference: string): boolean {
  const url = tryParseUrl(reference);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

/** True when `reference` is an absolute HTTPS URL — eligible for INLINE media
 *  (<img>, <video>, <audio>). HTTP is link-only; other schemes are text-only. */
export function isInlineHttps(reference: string): boolean {
  const url = tryParseUrl(reference);
  return url !== null && url.protocol === 'https:';
}

/** YouTube video IDs are well-defined URL-safe tokens. We require the classic
 *  11-character [A-Za-z0-9_-] form so a non-matching token falls back to a safe
 *  link-only render rather than a guessed embed. This never guesses: it only
 *  derives the token from a mechanically recognized YouTube URL form. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_LONG_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
]);
const YOUTUBE_SHORT_HOST = 'youtu.be';

/**
 * Derive a YouTube video ID from a recognized YouTube URL form, or null when no
 * exact usable ID can be derived (in which case the caller renders link-only).
 * Recognized forms mirror the P2M1 classifier: `youtu.be/<id>`,
 * `youtube.com/watch?v=<id>`, `/embed/<id>`, `/shorts/<id>` (with www/m hosts).
 * Pure; no network, no oEmbed, no guessing.
 */
export function deriveYouTubeVideoId(reference: string): string | null {
  const url = tryParseUrl(reference);
  if (url === null) return null;
  const host = url.hostname;
  let raw: string | null = null;
  if (host === YOUTUBE_SHORT_HOST) {
    raw = url.pathname.slice(1);
  } else if (YOUTUBE_LONG_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      raw = url.searchParams.get('v');
    } else if (url.pathname.startsWith('/embed/')) {
      raw = url.pathname.slice('/embed/'.length);
    } else if (url.pathname.startsWith('/shorts/')) {
      raw = url.pathname.slice('/shorts/'.length);
    }
  }
  if (raw === null) return null;
  // the ID is the first path segment of what was captured (guards against a
  // trailing slash or extra path after the id)
  raw = raw.split('/')[0];
  if (raw.length === 0 || !YOUTUBE_ID_RE.test(raw)) return null;
  return raw;
}

/** Privacy-conscious click-to-load YouTube embed target. Always HTTPS, always
 *  nocookie, never the arbitrary canonical URL. */
export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

/** Neutral, non-invented label for a classification kind, for reference links. */
export function mediaKindLabel(kind: MediaClassificationKind): string {
  switch (kind) {
    case 'IMAGE': return 'image';
    case 'VIDEO': return 'video';
    case 'AUDIO': return 'audio';
    case 'YOUTUBE': return 'YouTube';
    case 'UNKNOWN_REFERENCE': return 'media';
    default: return 'media';
  }
}

// ---------------------------------------------------------------------------
// Render descriptors (pure projection of already-classified references).
// ---------------------------------------------------------------------------

/** Safe rendering form for one media reference. */
export type MediaRenderMode = 'image' | 'video' | 'audio' | 'youtube' | 'link' | 'text';

/** Which manifest slot a render item came from (legacy `img`, or an
 *  `original` reference). Preserves manifest ordering semantics. */
export type MediaItemSource = 'img' | 'original';

/**
 * A safe render descriptor for one media reference. Deliberately carries NO
 * artifact/preservation fields (no artifactId, expectedSha256, archivePath,
 * rightsStatus, admissionState, …) — only what is needed to render a
 * historical external media reference safely.
 */
export interface MediaRenderItem {
  source: MediaItemSource;
  /** null for the legacy `img` slot; the manifest occurrenceIndex for an
   *  `original` reference. Preserves originalReference order. */
  occurrenceIndex: number | null;
  /** The classification kind FROM THE MANIFEST (not re-derived here). */
  kind: MediaClassificationKind;
  /** The exact reference string from the manifest, preserved verbatim. */
  reference: string;
  /** Safe rendering form. Inline media only when HTTPS; HTTP is link-only;
   *  unsafe schemes are text-only; YouTube needs a derivable ID. */
  mode: MediaRenderMode;
  /** An http(s) external link href, or null when the scheme is unsafe. */
  safeHref: string | null;
  /** Whether the reference itself is HTTPS (inline-eligible). Informational;
   *  YouTube embeds are always HTTPS by construction regardless of this flag. */
  inlineHttps: boolean;
  /** YouTube video ID, or null. Only set for mode 'youtube'. */
  videoId: string | null;
  /** Privacy-conscious nocookie embed URL, or null. Only set for mode 'youtube'. */
  embedUrl: string | null;
}

/**
 * Project one already-classified reference into a safe render descriptor. This
 * does NOT re-classify: it trusts the supplied `kind` and only decides the safe
 * rendering form from the reference URL. (A classification of IMAGE over a
 * YouTube URL stays IMAGE; a classification of YOUTUBE over a .png URL is treated
 * as YouTube. The manifest's classification is authoritative.)
 */
export function projectMediaItem(
  source: MediaItemSource,
  occurrenceIndex: number | null,
  classification: MediaClassification,
): MediaRenderItem {
  const { kind, reference } = classification;
  const safe = isSafeExternalHref(reference);
  const https = isInlineHttps(reference);
  const safeHref = safe ? reference : null;
  let mode: MediaRenderMode;
  let videoId: string | null = null;
  let embedUrl: string | null = null;

  switch (kind) {
    case 'IMAGE':
      mode = https ? 'image' : (safe ? 'link' : 'text');
      break;
    case 'VIDEO':
      mode = https ? 'video' : (safe ? 'link' : 'text');
      break;
    case 'AUDIO':
      mode = https ? 'audio' : (safe ? 'link' : 'text');
      break;
    case 'YOUTUBE':
      videoId = deriveYouTubeVideoId(reference);
      if (videoId !== null) {
        mode = 'youtube';
        embedUrl = youtubeEmbedUrl(videoId);
      } else {
        mode = safe ? 'link' : 'text';
      }
      break;
    case 'UNKNOWN_REFERENCE':
    default:
      // UNKNOWN never becomes inline media; it is a generic reference link (or
      // non-clickable text when the scheme is unsafe).
      mode = safe ? 'link' : 'text';
      break;
  }

  return { source, occurrenceIndex, kind, reference, mode, safeHref, inlineHttps: https, videoId, embedUrl };
}
// ---------------------------------------------------------------------------
// Per-record render items, preserving manifest order.
// ---------------------------------------------------------------------------

/**
 * Project all media references for one record into ordered render descriptors.
 * Order is authoritative from the manifest: the legacy `img` classification
 * first (when present), then `originalReferences` in their existing
 * occurrenceIndex order. No reordering, no deduplication — multiplicity in the
 * validated manifest is preserved. Returns [] when the record has no
 * interpretation (no media).
 */
export function renderItemsForRecord(interp: RecordMediaInterpretation | undefined | null): MediaRenderItem[] {
  if (!interp) return [];
  const items: MediaRenderItem[] = [];
  if (interp.imgClassification) {
    items.push(projectMediaItem('img', null, interp.imgClassification));
  }
  for (const ref of interp.originalReferences) {
    items.push(projectMediaItem('original', ref.occurrenceIndex, ref.classification));
  }
  return items;
}

// ---------------------------------------------------------------------------
// Generated media-interpretation loader (exact-generation binding, fail-closed).
// ---------------------------------------------------------------------------

export type MediaReaderState =
  | { status: 'unavailable' }
  | { status: 'verified'; byId: Map<string, RecordMediaInterpretation>; interpretations: RecordMediaInterpretation[] };

function fail(message: string): never {
  throw new Error(`Media reader state refused: ${message}`);
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${name} is not an object`);
  return value as Record<string, unknown>;
}

function readJsonFile(path: string, name: string): Record<string, unknown> {
  try {
    return asObject(JSON.parse(readFileSync(path, 'utf8')), name);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Media reader state refused:')) throw error;
    fail(`${name} is not valid JSON`);
  }
}

/**
 * Load the generated media-interpretation.json and prove it belongs to the
 * exact same generation as the generated reader snapshot, using the sealed P2M1
 * validator. Returns { status: 'unavailable' } when no generated snapshot
 * exists (clean checkout) so the build still succeeds. When a generated
 * snapshot IS present, media-interpretation.json must be present, valid, the same
 * generation, and the exact deterministic derivation of the snapshot — otherwise
 * this throws (fail-closed), failing the build rather than rendering a
 * partially trusted media state.
 */
export function loadMediaReaderState(generatedDirectory: string = resolve(process.cwd(), 'generated')): MediaReaderState {
  const snapshotPath = resolve(generatedDirectory, 'reader-snapshot.json');
  if (!existsSync(snapshotPath)) return { status: 'unavailable' };

  const mediaPath = resolve(generatedDirectory, 'media-interpretation.json');
  if (!existsSync(mediaPath)) {
    fail('media-interpretation.json is missing while a generated snapshot is present');
  }

  // Build the P2M1 validator's snapshot view from the raw reader snapshot. The
  // raw snapshot's provenance is the FULL LoreSourceProvenance (the same object
  // the importer wrote into both the snapshot and the manifest), so the
  // validator's deep-strict-equal provenance key-set match holds.
  const rawSnapshot = readJsonFile(snapshotPath, 'reader-snapshot.json');
  const rawProvenance = asObject(rawSnapshot.provenance, 'reader-snapshot provenance');
  const rawRecords = rawSnapshot.records;
  if (!Array.isArray(rawRecords)) fail('reader-snapshot records is not an array');

  const snapshot: InterpretationManifestSnapshot = {
    provenance: rawProvenance as unknown as LoreSourceProvenance,
    records: rawRecords.map((entry, index) => {
      const r = asObject(entry, `reader-snapshot record ${index}`);
      if (typeof r.canonicalId !== 'string' || r.canonicalId.length === 0) {
        fail(`reader-snapshot record ${index} canonicalId is invalid`);
      }
      const c = asObject(r.canonical, `reader-snapshot record ${index} canonical`);
      return {
        canonicalId: r.canonicalId as string,
        canonical: {
          img: typeof c.img === 'string' ? c.img : undefined,
          original: typeof c.original === 'string' ? c.original : undefined,
        },
      };
    }),
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mediaPath, 'utf8'));
  } catch {
    fail('media-interpretation.json is not valid JSON');
  }

  // Reuse the sealed P2M1 validator: proves provenance binding to this exact
  // generation AND that the manifest is the exact deterministic derivation of
  // the snapshot. Throws on any invalidity (fail-closed).
  const manifest = validateMediaInterpretationManifest(parsed, snapshot);

  const byId = new Map<string, RecordMediaInterpretation>();
  for (const interp of manifest.interpretations) byId.set(interp.canonicalId, interp);
  return { status: 'verified', byId, interpretations: manifest.interpretations };
}
