import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMediaReference,
  interpretOriginalMedia,
  buildMediaInterpretationManifest,
  validateMediaInterpretationManifest,
  MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  type MediaClassification,
} from '../src/lib/lore/media-interpretation.ts';
import { CANONICAL_REPOSITORY, CANONICAL_PATH } from '../src/lib/lore/provenance.ts';
import { buildSnapshot } from '../scripts/import-canonical-lore.mjs';

// ---------------------------------------------------------------------------
// Stage 2A-P2M1 — deterministic, fail-closed legacy media interpretation tests.
//
// Classification only: no preservation, no network, no rendering. Unknown stays
// unknown; a reference is never inferred to be an image merely because it came
// from the legacy field named `img`.
// ---------------------------------------------------------------------------

const KNOWN_IMG_A = 'https://toadaid.github.io/assets/lore/validator-awakening.jpg';
const KNOWN_IMG_B = 'https://toadaid.github.io/assets/lore/language-of-endurance.jpg';

function classify(ref: string): MediaClassification {
  const result = classifyMediaReference(ref);
  assert.equal(result !== null, true, `expected a classification for ${ref}`);
  return result as MediaClassification;
}

// 1-4. image extensions -> IMAGE
test('.jpg classifies as IMAGE', () => assert.equal(classify('https://example.test/file.jpg').kind, 'IMAGE'));
test('.jpeg classifies as IMAGE', () => assert.equal(classify('https://example.test/file.jpeg').kind, 'IMAGE'));
test('.png classifies as IMAGE', () => assert.equal(classify('https://example.test/file.png').kind, 'IMAGE'));
test('.webp classifies as IMAGE', () => assert.equal(classify('https://example.test/file.webp').kind, 'IMAGE'));
test('.gif and .avif also classify as IMAGE', () => {
  assert.equal(classify('https://example.test/file.gif').kind, 'IMAGE');
  assert.equal(classify('https://example.test/file.avif').kind, 'IMAGE');
});

// 5-6. direct video extensions -> VIDEO
test('direct .mp4 classifies as VIDEO', () => assert.equal(classify('https://example.test/clip.mp4').kind, 'VIDEO'));
test('direct .webm classifies as VIDEO', () => assert.equal(classify('https://example.test/clip.webm').kind, 'VIDEO'));
test('.mov also classifies as VIDEO', () => assert.equal(classify('https://example.test/clip.mov').kind, 'VIDEO'));

// 7-8. audio extensions -> AUDIO
test('.mp3 classifies as AUDIO', () => assert.equal(classify('https://example.test/track.mp3').kind, 'AUDIO'));
test('.ogg classifies as AUDIO', () => assert.equal(classify('https://example.test/track.ogg').kind, 'AUDIO'));
test('.m4a and .wav also classify as AUDIO', () => {
  assert.equal(classify('https://example.test/track.m4a').kind, 'AUDIO');
  assert.equal(classify('https://example.test/track.wav').kind, 'AUDIO');
});

// 9-10. YouTube forms -> YOUTUBE
test('youtube.com/watch classifies as YOUTUBE', () => {
  assert.equal(classify('https://www.youtube.com/watch?v=JVmwLJeeOy4').kind, 'YOUTUBE');
  assert.equal(classify('https://youtube.com/watch?v=abc123').kind, 'YOUTUBE');
  assert.equal(classify('https://m.youtube.com/watch?v=abc123').kind, 'YOUTUBE');
});
test('youtu.be/<id> classifies as YOUTUBE', () => {
  assert.equal(classify('https://youtu.be/abc123').kind, 'YOUTUBE');
});
test('youtube.com/embed and /shorts classify as YOUTUBE', () => {
  assert.equal(classify('https://www.youtube.com/embed/abc123').kind, 'YOUTUBE');
  assert.equal(classify('https://www.youtube.com/shorts/abc123').kind, 'YOUTUBE');
});

// 11. YouTube link mechanically discovered from `original`
test('a YouTube link in original markdown is discovered', () => {
  const refs = interpretOriginalMedia('see https://youtu.be/abc123 for more');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].classification.kind, 'YOUTUBE');
  assert.equal(refs[0].classification.reference, 'https://youtu.be/abc123');
  assert.equal(refs[0].occurrenceIndex, 0);
});
test('a YouTube URL inside markdown link syntax is discovered', () => {
  const refs = interpretOriginalMedia('watch [this](https://www.youtube.com/watch?v=xyz) now');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].classification.kind, 'YOUTUBE');
});
test('multiple media references in original are a bounded collection in document order', () => {
  const refs = interpretOriginalMedia('![pic](https://x.test/a.png) then https://youtu.be/vid then https://y.test/b.mp4');
  assert.deepEqual(refs.map((r) => r.classification.kind), ['IMAGE', 'YOUTUBE', 'VIDEO']);
  assert.deepEqual(refs.map((r) => r.occurrenceIndex), [0, 1, 2]);
});
test('ordinary non-media links in original are NOT emitted as media references', () => {
  const refs = interpretOriginalMedia('read https://example.com/blog/post and visit https://news.test/article');
  assert.equal(refs.length, 0);
});
test('an image embed in original markdown is discovered as IMAGE', () => {
  const refs = interpretOriginalMedia('![alt](https://x.test/pic.jpg)');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].classification.kind, 'IMAGE');
});

// 12-13. unknown references -> UNKNOWN_REFERENCE
test('an unsupported extension classifies as UNKNOWN_REFERENCE', () => {
  assert.equal(classify('https://example.test/file.xyz').kind, 'UNKNOWN_REFERENCE');
  assert.equal(classify('https://example.test/file.docx').kind, 'UNKNOWN_REFERENCE');
});
test('a URL with no extension classifies as UNKNOWN_REFERENCE', () => {
  assert.equal(classify('https://example.test/somepage').kind, 'UNKNOWN_REFERENCE');
  assert.equal(classify('https://example.test/').kind, 'UNKNOWN_REFERENCE');
});
test('a non-URL / malformed reference classifies as UNKNOWN_REFERENCE', () => {
  assert.equal(classify('not a url').kind, 'UNKNOWN_REFERENCE');
  assert.equal(classify('assets/lore/relative.jpg').kind, 'UNKNOWN_REFERENCE'); // relative, not absolute URL
});

// 14-15. query string / fragment after a valid extension still classify
test('a query string after a valid extension is handled correctly', () => {
  assert.equal(classify('https://example.test/file.jpg?x=1').kind, 'IMAGE');
  assert.equal(classify('https://example.test/clip.mp4?t=2').kind, 'VIDEO');
});
test('a fragment after a valid extension is handled correctly', () => {
  assert.equal(classify('https://example.test/file.jpg#section').kind, 'IMAGE');
  assert.equal(classify('https://example.test/track.mp3#t=10').kind, 'AUDIO');
});

// 16. fake .jpg in query text does NOT classify as IMAGE
test('a .jpg appearing only in a query parameter does NOT classify as IMAGE', () => {
  assert.equal(classify('https://example.test/page?file=photo.jpg').kind, 'UNKNOWN_REFERENCE');
  assert.equal(classify('https://example.test/watch?v=photo.jpg').kind, 'UNKNOWN_REFERENCE');
  assert.equal(classify('https://example.test/page#photo.jpg').kind, 'UNKNOWN_REFERENCE');
});
test('a YouTube URL with a .jpg inside its query is YOUTUBE, not IMAGE', () => {
  assert.equal(classify('https://www.youtube.com/watch?v=file.jpg').kind, 'YOUTUBE');
});

// 17. uppercase / mixed-case extension behavior
test('uppercase and mixed-case extensions classify case-insensitively', () => {
  assert.equal(classify('https://example.test/file.JPG').kind, 'IMAGE');
  assert.equal(classify('https://example.test/file.JpG').kind, 'IMAGE');
  assert.equal(classify('https://example.test/CLIP.MP4').kind, 'VIDEO');
  assert.equal(classify('https://example.test/Track.OgG').kind, 'AUDIO');
});

// 18. empty / absent `img` behavior
test('an empty or absent reference yields no classification', () => {
  assert.equal(classifyMediaReference(''), null);
  assert.equal(classifyMediaReference(undefined as unknown as string), null);
});
test('interpretOriginalMedia on empty/non-string yields an empty array', () => {
  assert.deepEqual(interpretOriginalMedia(''), []);
  assert.deepEqual(interpretOriginalMedia(undefined as unknown as string), []);
});

// 19-22. the two known dangling lore refs classify as IMAGE without any
// preservation / admission / artifact fields.
test('the two known dangling lore references classify as IMAGE', () => {
  for (const ref of [KNOWN_IMG_A, KNOWN_IMG_B]) {
    const c = classify(ref);
    assert.equal(c.kind, 'IMAGE');
  }
});
test('classifications carry only kind and reference — no preservation/artifact fields', () => {
  for (const ref of [KNOWN_IMG_A, KNOWN_IMG_B]) {
    const c = classify(ref);
    assert.deepEqual(Object.keys(c).sort(), ['kind', 'reference']);
  }
});

// 23. no network dependency: classification must not reach the network.
test('classification performs no network access', () => {
  const calls: string[] = [];
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch: unknown }).fetch = (...args: unknown[]) => {
    calls.push('fetch');
    throw new Error('network must not be used by the classifier');
  };
  try {
    for (const ref of [
      'https://example.test/file.jpg',
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'https://example.test/clip.mp4',
      'https://example.test/unknown.xyz',
    ]) {
      classifyMediaReference(ref);
    }
    interpretOriginalMedia('https://youtu.be/abc https://x.test/a.png');
  } finally {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  }
  assert.deepEqual(calls, []);
});

// supported extension lists are exactly the documented sets
test('supported extension lists are the documented explicit sets', () => {
  assert.deepEqual([...IMAGE_EXTENSIONS].sort(), ['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
  assert.deepEqual([...VIDEO_EXTENSIONS].sort(), ['mov', 'mp4', 'webm']);
  assert.deepEqual([...AUDIO_EXTENSIONS].sort(), ['m4a', 'mp3', 'ogg', 'wav']);
});

// ---------------------------------------------------------------------------
// Manifest integration: separate derived layer; sealed P2 candidate untouched.
// ---------------------------------------------------------------------------

const provenance = {
  repository: CANONICAL_REPOSITORY,
  path: CANONICAL_PATH,
  commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
};
const generatedAt = '2026-08-19T00:00:00.000Z';

function buildManifest(source: string) {
  const { source: prov, snapshot } = buildSnapshot(source, provenance, generatedAt);
  const manifest = buildMediaInterpretationManifest(snapshot.records, prov);
  return { prov, snapshot, manifest };
}

const twoImgAndOriginalFixture = JSON.stringify([
  { id: 'TOBY_T1201_TheValidatorAwakening', date: '2025-11-10', title: 'The Validator Awakening', comment: 'c', original: 'o', url: '', img: KNOWN_IMG_A, tags: 't' },
  { id: 'TOBY_T1203_TheLanguageOfEndurance', date: '2025-12-17', title: 'The Language of Endurance', comment: 'c', original: 'o', url: '', img: KNOWN_IMG_B, tags: 't' },
  { id: 'TOBY_T016_ClairDeLune', date: '2025-01-01', title: 'Clair de Lune', comment: 'c', original: 'listen https://youtu.be/abc123', url: '', img: '', tags: 't' },
  { id: 'TOBY_T001_FirstRipple', date: '2024-03-17', title: 'First Ripple', comment: 'c', original: 'no media here', url: '', img: '', tags: 't' },
]);

test('the manifest classifies the two known img refs as IMAGE and discovers original YouTube', () => {
  const { manifest } = buildManifest(twoImgAndOriginalFixture);
  assert.equal(manifest.counts.IMAGE, 2);
  assert.equal(manifest.counts.YOUTUBE, 1);
  assert.equal(manifest.interpretedRecordCount, 3); // 2 img + 1 original record
  assert.equal(manifest.referenceCount, 3);
  const validator = buildManifest(twoImgAndOriginalFixture);
  validateMediaInterpretationManifest(validator.manifest, validator.snapshot);
});

test('the manifest introduces no artifactId, expectedSha256, or archivePath anywhere', () => {
  const { manifest } = buildManifest(twoImgAndOriginalFixture);
  for (const entry of manifest.interpretations) {
    assert.equal('artifactId' in entry, false);
    assert.equal('expectedSha256' in entry, false);
    assert.equal('archivePath' in entry, false);
    if (entry.imgClassification) {
      assert.equal('artifactId' in entry.imgClassification, false);
      assert.equal('expectedSha256' in entry.imgClassification, false);
      assert.equal('archivePath' in entry.imgClassification, false);
    }
    for (const ref of entry.originalReferences) {
      assert.equal('artifactId' in ref.classification, false);
      assert.equal('expectedSha256' in ref.classification, false);
      assert.equal('archivePath' in ref.classification, false);
    }
  }
});

test('an unknown legacy img is an UNKNOWN_REFERENCE candidate in the manifest (not guessed)', () => {
  const fixture = JSON.stringify([
    { id: 'TOBY_X', date: '2024-01-01', title: 'X', comment: 'c', img: 'https://example.test/nope' },
  ]);
  const { manifest } = buildManifest(fixture);
  assert.equal(manifest.counts.UNKNOWN_REFERENCE, 1);
  assert.equal(manifest.interpretations[0].imgClassification.kind, 'UNKNOWN_REFERENCE');
});

test('a record with no media at all does not appear in interpretations', () => {
  const fixture = JSON.stringify([
    { id: 'TOBY_EMPTY', date: '2024-01-01', title: 'E', comment: 'c', original: 'just text', img: '' },
  ]);
  const { manifest } = buildManifest(fixture);
  assert.equal(manifest.interpretedRecordCount, 0);
  assert.deepEqual(manifest.interpretations, []);
});

test('manifest generation is deterministic across repeated builds', () => {
  const a = buildManifest(twoImgAndOriginalFixture).manifest;
  const b = buildManifest(twoImgAndOriginalFixture).manifest;
  assert.deepEqual(a, b);
});

test('manifest provenance is bound to the same generation and schemaVersion is fixed', () => {
  const { manifest } = buildManifest(twoImgAndOriginalFixture);
  assert.equal(manifest.schemaVersion, MEDIA_INTERPRETATION_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.provenance.commit, provenance.commit);
  assert.equal(manifest.provenance.repository, CANONICAL_REPOSITORY);
  assert.equal(manifest.provenance.path, CANONICAL_PATH);
});

// Fail-closed manifest validation
test('wrong provenance repository is refused', () => {
  const { manifest, snapshot } = buildManifest(twoImgAndOriginalFixture);
  const m = JSON.parse(JSON.stringify(manifest));
  m.provenance.repository = 'other/repo';
  assert.throws(() => validateMediaInterpretationManifest(m, snapshot), /repository mismatch/);
});
test('wrong provenance commit is refused', () => {
  const { manifest, snapshot } = buildManifest(twoImgAndOriginalFixture);
  const m = JSON.parse(JSON.stringify(manifest));
  m.provenance.commit = '0'.repeat(40);
  assert.throws(() => validateMediaInterpretationManifest(m, snapshot), /commit mismatch/);
});
test('a counts mismatch is refused', () => {
  const { manifest, snapshot } = buildManifest(twoImgAndOriginalFixture);
  const m = JSON.parse(JSON.stringify(manifest));
  m.counts.IMAGE = 99;
  assert.throws(() => validateMediaInterpretationManifest(m, snapshot), /referenceCount does not equal/);
});
test('an injected artifactId on an interpretation is refused', () => {
  const { manifest, snapshot } = buildManifest(twoImgAndOriginalFixture);
  const m = JSON.parse(JSON.stringify(manifest));
  (m.interpretations[0] as Record<string, unknown>).artifactId = 'X_MEDIA_Y';
  assert.throws(() => validateMediaInterpretationManifest(m, snapshot), /artifactId/);
});
test('an imgClassification that disagrees with the snapshot img is refused', () => {
  const { manifest, snapshot } = buildManifest(twoImgAndOriginalFixture);
  const m = JSON.parse(JSON.stringify(manifest));
  // Find an entry with an imgClassification and corrupt its kind.
  const entry = m.interpretations.find((i: { imgClassification?: { kind: string } }) => i.imgClassification);
  (entry as { imgClassification: { kind: string } }).imgClassification.kind = 'YOUTUBE';
  assert.throws(() => validateMediaInterpretationManifest(m, snapshot), /imgClassification does not match/);
});
test('an originalReference not present in the snapshot original is refused', () => {
  const { manifest, snapshot } = buildManifest(twoImgAndOriginalFixture);
  const m = JSON.parse(JSON.stringify(manifest));
  const entry = m.interpretations.find((i: { originalReferences: { classification: { reference: string } }[] }) => i.originalReferences.length > 0);
  (entry as { originalReferences: { classification: { reference: string } }[] }).originalReferences[0].classification.reference = 'https://youtu.be/NOTINTEXT';
  assert.throws(() => validateMediaInterpretationManifest(m, snapshot), /not found in snapshot original/);
});