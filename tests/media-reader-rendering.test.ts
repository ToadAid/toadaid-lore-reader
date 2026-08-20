import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../scripts/import-canonical-lore.mjs';
import { buildMediaInterpretationManifest, classifyMediaReference } from '../src/lib/lore/media-interpretation.ts';
import { CANONICAL_REPOSITORY, CANONICAL_PATH } from '../src/lib/lore/provenance.ts';
import {
  loadMediaReaderState,
  renderItemsForRecord,
  projectMediaItem,
  deriveYouTubeVideoId,
  isSafeExternalHref,
  isInlineHttps,
  mediaKindLabel,
} from '../src/lib/lore/media-reader-state.ts';

// ---------------------------------------------------------------------------
// Stage 2A-P2M2 — media-aware Reader rendering tests.
//
// These are UNIT tests over the pure P2M2 rendering projection + the fail-
// closed loader. They must NOT depend on the gitignored operator `generated/`
// artifacts (absent on a clean checkout / CI). A small canonical-shaped fixture
// is authored inline and built in-memory via the same pure buildSnapshot(...) +
// buildMediaInterpretationManifest(...) the importer uses, then written to a
// throwaway temp directory so loadMediaReaderState's exact-generation binding
// path is exercised against real files. No network access anywhere.
//
// This is NOT the real 130-record canonical generation. The canonical-
// generation proof remains a separate governed operator ceremony.
// ---------------------------------------------------------------------------

const FIXTURE_COMMIT = '0'.repeat(40);
const FIXTURE_GENERATED_AT = '2026-08-20T00:00:00.000Z';

const FIXTURE_SOURCE = JSON.stringify([
  // IMAGE over HTTPS — inline image render.
  { id: 'M_IMG_HTTPS', date: '2024-01-01', title: 'Img Https', comment: 'c', original: '', url: '', img: 'https://example.test/a.jpg', tags: 't' },
  // IMAGE over HTTP — link-only (never inline).
  { id: 'M_IMG_HTTP', date: '2024-01-02', title: 'Img Http', comment: 'c', original: '', url: '', img: 'http://example.test/b.png', tags: 't' },
  // VIDEO over HTTPS — inline <video>.
  { id: 'M_VID', date: '2024-01-03', title: 'Video', comment: 'c', original: 'see https://cdn.test/v.mp4 here', url: '', img: '', tags: 't' },
  // AUDIO over HTTPS — inline <audio>.
  { id: 'M_AUD', date: '2024-01-04', title: 'Audio', comment: 'c', original: 'hear https://cdn.test/song.ogg', url: '', img: '', tags: 't' },
  // YouTube in several recognized forms (watch / youtu.be / embed / shorts).
  { id: 'M_YT', date: '2024-01-05', title: 'YouTube', comment: 'c',
    original: 'watch https://www.youtube.com/watch?v=dQw4w9WgXcQ and https://youtu.be/abcdefghijk and https://www.youtube.com/embed/JVmwLJeeOy4 and https://www.youtube.com/shorts/0123456789a', url: '', img: '', tags: 't' },
  // Malformed YouTube: a /watch form with a too-short id → classified YOUTUBE
  // (host/path shape) but no derivable 11-char id → link-only. A non-media
  // youtube.com path classifies UNKNOWN and is NOT emitted as a reference.
  { id: 'M_YT_BAD', date: '2024-01-06', title: 'YouTube Bad', comment: 'c', original: 'https://www.youtube.com/watch?v=short', url: '', img: '', tags: 't' },
  // UNKNOWN_REFERENCE via legacy img (a non-media URL) → generic reference link.
  { id: 'M_UNK', date: '2024-01-07', title: 'Unknown', comment: 'c', original: '', url: '', img: 'https://example.test/document.pdf', tags: 't' },
  // Unsafe scheme via legacy img → non-clickable escaped text only.
  { id: 'M_UNSAFE', date: '2024-01-08', title: 'Unsafe', comment: 'c', original: '', url: '', img: 'file:///etc/passwd', tags: 't' },
  // No media at all → must not appear in interpretations / byId.
  { id: 'M_NOMEDIA', date: '2024-01-09', title: 'No Media', comment: 'c', original: 'just plain prose, no media', url: '', img: '', tags: 't' },
  // Two original references of the same kind → occurrence order preserved.
  { id: 'M_ORDER', date: '2024-01-10', title: 'Order', comment: 'c', original: 'first https://cdn.test/a.mp4 then https://cdn.test/b.mp4', url: '', img: '', tags: 't' },
  // Legacy img AND original reference → img-first ordering.
  { id: 'M_BOTH', date: '2024-01-11', title: 'Both', comment: 'c', original: 'https://cdn.test/clip.mp4', url: '', img: 'https://example.test/cover.webp', tags: 't' },
]);

function buildFixtureDir(): { dir: string; snapshot: ReturnType<typeof buildSnapshot>['snapshot']; manifest: ReturnType<typeof buildMediaInterpretationManifest> } {
  const { snapshot, manifest } = buildMediaSnapshotManifest();
  const dir = mkdtempSync(join(tmpdir(), 'p2m2-media-'));
  writeFileSync(join(dir, 'reader-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(join(dir, 'media-interpretation.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, snapshot, manifest };
}

function buildMediaSnapshotManifest() {
  const { snapshot } = buildSnapshot(
    FIXTURE_SOURCE,
    { repository: CANONICAL_REPOSITORY, path: CANONICAL_PATH, commit: FIXTURE_COMMIT },
    FIXTURE_GENERATED_AT,
  );
  const manifest = buildMediaInterpretationManifest(snapshot.records, snapshot.provenance);
  return { snapshot, manifest };
}

// ---------------------------------------------------------------------------
// Loader: unavailable + fail-closed binding.
// ---------------------------------------------------------------------------

test('loadMediaReaderState is unavailable when no generated snapshot exists (clean checkout)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2m2-empty-'));
  try {
    assert.equal(loadMediaReaderState(dir).status, 'unavailable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMediaReaderState fails closed when a snapshot exists but media-interpretation.json is missing', () => {
  const { snapshot, dir } = buildFixtureDir();
  try {
    rmSync(join(dir, 'media-interpretation.json'), { force: true });
    assert.throws(() => loadMediaReaderState(dir), /Media reader state refused:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMediaReaderState fails closed on wrong provenance (commit drift from the snapshot)', () => {
  const { snapshot, manifest, dir } = buildFixtureDir();
  try {
    const tampered = JSON.parse(JSON.stringify(manifest));
    tampered.provenance.commit = 'f'.repeat(40); // differs from snapshot commit
    writeFileSync(join(dir, 'media-interpretation.json'), JSON.stringify(tampered));
    assert.throws(() => loadMediaReaderState(dir), /Media interpretation manifest refused:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMediaReaderState fails closed on a manifest that is not the exact deterministic derivation', () => {
  const { manifest, dir } = buildFixtureDir();
  try {
    const tampered = JSON.parse(JSON.stringify(manifest));
    // Tamper the occurrenceIndex of a recognized original reference. This passes
    // the validator's per-ref plausibility checks (it only requires an integer)
    // but fails the final authoritative deep-strict-equal derivation gate.
    const ytIdx = tampered.interpretations.findIndex((i: { canonicalId: string }) => i.canonicalId === 'M_YT');
    tampered.interpretations[ytIdx].originalReferences[0].occurrenceIndex = 99;
    writeFileSync(join(dir, 'media-interpretation.json'), JSON.stringify(tampered));
    assert.throws(() => loadMediaReaderState(dir), /Media interpretation manifest refused:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadMediaReaderState verifies and exposes an exact canonicalId lookup of the fixture interpretations', () => {
  const { dir, manifest } = buildFixtureDir();
  try {
    const state = loadMediaReaderState(dir);
    assert.equal(state.status, 'verified');
    if (state.status !== 'verified') return; // narrow
    assert.equal(state.interpretations.length, manifest.interpretations.length);
    // M_NOMEDIA must be absent from byId (no media) — exact lookup semantics.
    assert.equal(state.byId.get('M_NOMEDIA'), undefined);
    // A present record resolves to its exact interpretation object.
    const yt = state.byId.get('M_YT');
    assert.ok(yt, 'M_YT should have an interpretation');
    assert.equal(yt.canonicalId, 'M_YT');
    assert.equal(yt.originalReferences.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Pure projection: render descriptors per kind + scheme.
// ---------------------------------------------------------------------------

test('renderItemsForRecord yields no items for a record with no interpretation', () => {
  assert.deepEqual(renderItemsForRecord(undefined), []);
  assert.deepEqual(renderItemsForRecord(null), []);
});

test('IMAGE over HTTPS renders as an inline image; IMAGE over HTTP renders link-only', () => {
  const state = fixtureState();
  const https = renderItemsForRecord(state.byId.get('M_IMG_HTTPS'));
  assert.equal(https.length, 1);
  assert.equal(https[0].source, 'img');
  assert.equal(https[0].occurrenceIndex, null);
  assert.equal(https[0].kind, 'IMAGE');
  assert.equal(https[0].mode, 'image');
  assert.equal(https[0].safeHref, 'https://example.test/a.jpg');
  assert.equal(https[0].inlineHttps, true);

  const http = renderItemsForRecord(state.byId.get('M_IMG_HTTP'));
  assert.equal(http.length, 1);
  assert.equal(http[0].kind, 'IMAGE');
  assert.equal(http[0].mode, 'link', 'HTTP IMAGE must never render inline');
  assert.equal(http[0].inlineHttps, false);
  assert.equal(http[0].safeHref, 'http://example.test/b.png');
});

test('VIDEO and AUDIO over HTTPS render as inline video/audio (not image)', () => {
  const state = fixtureState();
  const video = renderItemsForRecord(state.byId.get('M_VID'));
  assert.equal(video.length, 1);
  assert.equal(video[0].kind, 'VIDEO');
  assert.equal(video[0].mode, 'video');
  assert.equal(video[0].safeHref, 'https://cdn.test/v.mp4');

  const audio = renderItemsForRecord(state.byId.get('M_AUD'));
  assert.equal(audio.length, 1);
  assert.equal(audio[0].kind, 'AUDIO');
  assert.equal(audio[0].mode, 'audio');
});

test('YouTube IDs are derived mechanically from watch / youtu.be / embed / shorts forms', () => {
  const state = fixtureState();
  const items = renderItemsForRecord(state.byId.get('M_YT'));
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.mode), ['youtube', 'youtube', 'youtube', 'youtube']);
  assert.equal(items[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(items[0].embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(items[1].videoId, 'abcdefghijk');
  assert.equal(items[2].videoId, 'JVmwLJeeOy4');
  assert.equal(items[3].videoId, '0123456789a');
  // The 'Open on YouTube' link uses the original reference, not the embed.
  assert.equal(items[0].safeHref, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('YouTube with a non-11-char id falls back to a safe link, never a guessed embed', () => {
  const state = fixtureState();
  const items = renderItemsForRecord(state.byId.get('M_YT_BAD'));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'YOUTUBE');
  assert.equal(items[0].mode, 'link', 'a YouTube form with no usable id must be link-only');
  assert.equal(items[0].videoId, null);
  assert.equal(items[0].embedUrl, null);
  assert.ok(items[0].safeHref, 'the original reference remains linkable');
});

test('UNKNOWN_REFERENCE renders as a generic media-reference link (HTTPS)', () => {
  const state = fixtureState();
  const items = renderItemsForRecord(state.byId.get('M_UNK'));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'UNKNOWN_REFERENCE');
  assert.equal(items[0].mode, 'link');
  assert.equal(items[0].safeHref, 'https://example.test/document.pdf');
});

test('non-HTTP(S) / unsafe schemes are never clickable or embedded (file: → text)', () => {
  const state = fixtureState();
  const items = renderItemsForRecord(state.byId.get('M_UNSAFE'));
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'UNKNOWN_REFERENCE');
  assert.equal(items[0].mode, 'text', 'file: must render as non-clickable text');
  assert.equal(items[0].safeHref, null);
  // Pure safety helpers: javascript:, data:, file: are all refused for linking
  // and refused for inline media.
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
    assert.equal(isSafeExternalHref(unsafe), false);
    assert.equal(isInlineHttps(unsafe), false);
  }
  // The reference string is still carried verbatim (it is escaped by the page).
  assert.equal(items[0].reference, 'file:///etc/passwd');
});

test('occurrence order of original references is preserved (no reordering, no dedup)', () => {
  const state = fixtureState();
  const items = renderItemsForRecord(state.byId.get('M_ORDER'));
  assert.equal(items.length, 2);
  assert.equal(items[0].source, 'original');
  assert.equal(items[0].occurrenceIndex, 0);
  assert.equal(items[0].safeHref, 'https://cdn.test/a.mp4');
  assert.equal(items[1].source, 'original');
  assert.equal(items[1].occurrenceIndex, 1);
  assert.equal(items[1].safeHref, 'https://cdn.test/b.mp4');
});

test('reference order: legacy img classification first, then originalReferences in order', () => {
  const state = fixtureState();
  const items = renderItemsForRecord(state.byId.get('M_BOTH'));
  assert.equal(items.length, 2);
  assert.equal(items[0].source, 'img');
  assert.equal(items[0].occurrenceIndex, null);
  assert.equal(items[0].kind, 'IMAGE');
  assert.equal(items[0].mode, 'image');
  assert.equal(items[1].source, 'original');
  assert.equal(items[1].occurrenceIndex, 0);
  assert.equal(items[1].kind, 'VIDEO');
  assert.equal(items[1].mode, 'video');
});

// ---------------------------------------------------------------------------
// Render descriptors carry NO artifact / preservation fields (governance wall).
// ---------------------------------------------------------------------------

test('MediaRenderItem carries no artifactId / preservation / rights fields', () => {
  const state = fixtureState();
  const all = state.interpretations.flatMap((i) => renderItemsForRecord(i));
  assert.ok(all.length > 0);
  const forbidden = [
    'artifactId', 'expectedSha256', 'archivePath', 'observedSha256',
    'rightsStatus', 'rightsPosture', 'attribution', 'admissionState',
    'preservationState', 'localAvailability', 'mimeType', 'byteSize',
  ];
  for (const item of all) {
    for (const field of forbidden) {
      assert.ok(!(field in item), `render item must not carry '${field}'`);
    }
  }
});

test('deriveYouTubeVideoId refuses to guess and only recognizes the four known forms', () => {
  assert.equal(deriveYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(deriveYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'), 'dQw4w9WgXcQ');
  assert.equal(deriveYouTubeVideoId('https://m.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(deriveYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  // Not a recognized form, or not 11 chars → null (link-only fallback in caller).
  assert.equal(deriveYouTubeVideoId('https://youtube.com/watch?v=short'), null);
  assert.equal(deriveYouTubeVideoId('https://youtube.com/unknown/dQw4w9WgXcQ'), null);
  assert.equal(deriveYouTubeVideoId('https://example.test/dQw4w9WgXcQ'), null);
  assert.equal(deriveYouTubeVideoId('not a url'), null);
});

test('mediaKindLabel and URL-safety helpers are neutral and exact', () => {
  assert.equal(mediaKindLabel('IMAGE'), 'image');
  assert.equal(mediaKindLabel('VIDEO'), 'video');
  assert.equal(mediaKindLabel('AUDIO'), 'audio');
  assert.equal(mediaKindLabel('YOUTUBE'), 'YouTube');
  assert.equal(mediaKindLabel('UNKNOWN_REFERENCE'), 'media');
  assert.equal(isInlineHttps('https://x.test'), true);
  assert.equal(isInlineHttps('http://x.test'), false, 'HTTP is not inline-eligible');
  assert.equal(isSafeExternalHref('https://x.test'), true);
  assert.equal(isSafeExternalHref('http://x.test'), true);
});

test('projectMediaItem never embeds a non-HTTPS reference as inline media', () => {
  // Direct projection of the boundary: HTTP IMAGE is link, not image.
  const httpImg = projectMediaItem('img', null, { kind: 'IMAGE', reference: 'http://x.test/a.jpg' });
  assert.equal(httpImg.mode, 'link');
  const httpsImg = projectMediaItem('img', null, { kind: 'IMAGE', reference: 'https://x.test/a.jpg' });
  assert.equal(httpsImg.mode, 'image');
  // An unparseable IMAGE reference is text-only.
  const bad = projectMediaItem('img', null, { kind: 'IMAGE', reference: 'not a url at all' });
  assert.equal(bad.mode, 'text');
  assert.equal(bad.safeHref, null);
});

// Build the fixture once for the pure-projection tests (no per-test I/O).
let cachedState: ReturnType<typeof loadMediaReaderState> | null = null;
function fixtureState(): Extract<ReturnType<typeof loadMediaReaderState>, { status: 'verified' }> {
  if (!cachedState) {
    const { dir } = buildFixtureDir();
    // Leak the temp dir for the process lifetime; these are tiny and live in
    // the OS tmp dir. The unavailable / fail-closed tests make their own dirs.
    const state = loadMediaReaderState(dir);
    if (state.status !== 'verified') throw new Error('fixture state did not verify');
    cachedState = state;
  }
  return cachedState as Extract<ReturnType<typeof loadMediaReaderState>, { status: 'verified' }>;
}

// ---------------------------------------------------------------------------
// Stage 2A-P2M2 narrow rendering safety repair — defect regression tests.
// ---------------------------------------------------------------------------

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RECORD_PAGE_SRC = readFileSync(join(TEST_DIR, '..', 'src', 'pages', 'record', '[canonicalId].astro'), 'utf8');
const READER_CSS_SRC = readFileSync(join(TEST_DIR, '..', 'src', 'styles', 'reader.css'), 'utf8');

// --- Defect 1: unsafe-scheme YOUTUBE must never become active ----------------

test('P2M1 still classifies youtube-host unsafe-scheme URLs as YOUTUBE (the defect precondition)', () => {
  // These ARE YOUTUBE by host/path shape (P2M1 is scheme-agnostic) — which is
  // exactly why the rendering layer must independently gate on a safe scheme.
  assert.equal(classifyMediaReference('file://youtube.com/watch?v=dQw4w9WgXcQ')?.kind, 'YOUTUBE');
  assert.equal(classifyMediaReference('javascript://youtube.com/watch?v=dQw4w9WgXcQ')?.kind, 'YOUTUBE');
});

test('Defect 1: file:// YouTube never becomes mode youtube / embed / active link', () => {
  const item = projectMediaItem('original', 0, { kind: 'YOUTUBE', reference: 'file://youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(item.mode, 'text', 'unsafe-scheme YouTube must be text-only');
  assert.equal(item.safeHref, null, 'no active link for unsafe scheme');
  assert.equal(item.videoId, null, 'no active video id projected for unsafe scheme');
  assert.equal(item.embedUrl, null, 'no embed url projected for unsafe scheme');
  assert.equal(item.inlineHttps, false);
});

test('Defect 1: javascript:// YouTube never becomes mode youtube / embed / active link', () => {
  const item = projectMediaItem('original', 0, { kind: 'YOUTUBE', reference: 'javascript://youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(item.mode, 'text');
  assert.equal(item.safeHref, null);
  assert.equal(item.videoId, null);
  assert.equal(item.embedUrl, null);
});

test('Defect 1: other unsafe schemes (data:, ftp:) over a youtube host stay non-active', () => {
  for (const ref of ['data://youtube.com/watch?v=dQw4w9WgXcQ', 'ftp://youtube.com/watch?v=dQw4w9WgXcQ']) {
    const item = projectMediaItem('original', 0, { kind: 'YOUTUBE', reference: ref });
    assert.equal(item.mode, 'text', `${ref} must be text-only`);
    assert.equal(item.safeHref, null);
    assert.equal(item.embedUrl, null);
  }
});

test('Defect 1: safe HTTPS YouTube still click-loads the nocookie iframe', () => {
  const item = projectMediaItem('original', 0, { kind: 'YOUTUBE', reference: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(item.mode, 'youtube');
  assert.equal(item.videoId, 'dQw4w9WgXcQ');
  assert.equal(item.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(item.safeHref, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('Defect 1: safe HTTP YouTube satisfies the safe-web-scheme boundary and activates the HTTPS nocookie player', () => {
  const item = projectMediaItem('original', 0, { kind: 'YOUTUBE', reference: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(item.mode, 'youtube', 'safe HTTP YouTube may click-to-load; embed is HTTPS nocookie by construction');
  assert.equal(item.videoId, 'dQw4w9WgXcQ');
  assert.equal(item.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(item.inlineHttps, false);
  assert.equal(item.safeHref, 'http://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

// --- Defect 2: VIDEO / AUDIO must retain an external reference link -----------

test('Defect 2: projection retains safeHref for VIDEO and AUDIO', () => {
  const state = fixtureState();
  const video = renderItemsForRecord(state.byId.get('M_VID'));
  const audio = renderItemsForRecord(state.byId.get('M_AUD'));
  assert.equal(video[0].mode, 'video');
  assert.ok(video[0].safeHref, 'VIDEO must carry safeHref for the external link');
  assert.equal(audio[0].mode, 'audio');
  assert.ok(audio[0].safeHref, 'AUDIO must carry safeHref for the external link');
});

test('Defect 2: the record page template emits a native <video> AND a nearby external reference link', () => {
  assert.match(RECORD_PAGE_SRC, /<video class="media-video" controls preload="none"/, 'native <video> with controls + preload none');
  assert.match(RECORD_PAGE_SRC, /<source src=\{item\.safeHref\} \/><\/video><a class="source-link media-ref" href=\{item\.safeHref\} target="_blank" rel="noreferrer">External media reference \(video\) ↗<\/a>/, 'VIDEO must be followed by a safe external reference link');
});

test('Defect 2: the record page template emits a native <audio> AND a nearby external reference link', () => {
  assert.match(RECORD_PAGE_SRC, /<audio class="media-audio" controls preload="none"/, 'native <audio> with controls + preload none');
  assert.match(RECORD_PAGE_SRC, /<source src=\{item\.safeHref\} \/><\/audio><a class="source-link media-ref" href=\{item\.safeHref\} target="_blank" rel="noreferrer">External media reference \(audio\) ↗<\/a>/, 'AUDIO must be followed by a safe external reference link');
});

// --- Defect 3: activated YouTube iframe must be mobile-bounded ----------------

test('Defect 3: the runtime script gives the activated iframe the dedicated bounded class', () => {
  assert.match(RECORD_PAGE_SRC, /iframe\.className\s*=\s*['"]media-youtube-frame['"]/, 'iframe must receive the media-youtube-frame class');
});

test('Defect 3: the stylesheet bounds the activated iframe (max-width / width / aspect ratio)', () => {
  const block = READER_CSS_SRC.match(/\.media-youtube-frame\s*\{[^}]*\}/);
  assert.ok(block, '.media-youtube-frame rule must exist in reader.css');
  const rule = block[0];
  assert.match(rule, /max-width:\s*100%/, 'iframe max-width: 100% to prevent overflow');
  assert.match(rule, /width:\s*100%/, 'iframe width: 100%');
  assert.match(rule, /aspect-ratio:\s*16\s*\/\s*9/, 'iframe responsive 16/9 aspect ratio');
  assert.match(rule, /height:\s*auto/, 'iframe height: auto');
});

// --- No regression: autoplay must never appear; zero build-time iframe --------

test('No regression: no autoplay is configured for the YouTube iframe', () => {
  assert.ok(!/autoplay\s*=\s*['"]?1?['"]?/.test(RECORD_PAGE_SRC), 'no autoplay attribute');
  // The embed URL must not carry autoplay=1 either.
  const state = fixtureState();
  const yt = renderItemsForRecord(state.byId.get('M_YT'));
  for (const item of yt) {
    assert.ok(!item.embedUrl?.includes('autoplay'), 'embed url must not enable autoplay');
  }
});

test('No regression: no build-time <iframe> is emitted by the record page template', () => {
  // The only iframe reference must be the runtime createElement string, never a
  // literal <iframe> element in the build-time HTML.
  assert.ok(!/<iframe/.test(RECORD_PAGE_SRC), 'no literal <iframe> element in the template');
  assert.match(RECORD_PAGE_SRC, /createElement\('iframe'\)/, 'iframe is created at runtime only');
});