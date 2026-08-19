import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot } from '../scripts/import-canonical-lore.mjs';
import {
  buildLegacyMediaCandidateManifest,
  validateLegacyMediaCandidateManifest,
  LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION,
} from '../src/lib/lore/legacy-media-candidates.ts';
import { isValidArtifactId } from '../src/lib/lore/canonical-schema.ts';

const provenance = {
  repository: 'ToadAid/toadaid.github.io',
  path: 'lore/data.json',
  commit: '464933cecb6f508a980a66d37c8a7ef7add2f53d',
};
const generatedAt = '2026-08-19T00:00:00.000Z';

// Fixture mirroring the current canonical media truth: the two known non-empty
// legacy `img` records plus one empty-img record. (Production logic is generic;
// these IDs are the current known canonical fixture/import truth.)
const twoImgFixture = JSON.stringify([
  { id: 'TOBY_T1201_TheValidatorAwakening', date: '2025-11-10', title: 'The Validator Awakening', comment: 'c', original: 'o', url: 'https://x.com/toadgod1017/status/1987779173637898316?s=20', img: 'https://toadaid.github.io/assets/lore/validator-awakening.jpg', tags: 't' },
  { id: 'TOBY_T1203_TheLanguageOfEndurance', date: '2025-12-17', title: 'The Language of Endurance', comment: 'c', original: 'o', url: 'https://x.com/toadgod1017/status/2001178819710083176?s=20', img: 'https://toadaid.github.io/assets/lore/language-of-endurance.jpg', tags: 't' },
  { id: 'TOBY_T001_FirstRipple', date: '2024-03-17', title: 'First Ripple', comment: 'c', original: 'o', url: 'https://x.com/example', img: '', tags: 't' },
]);

function build(source = twoImgFixture) {
  const { source: prov, snapshot } = buildSnapshot(source, provenance, generatedAt);
  const manifest = buildLegacyMediaCandidateManifest(snapshot.records, prov);
  return { prov, snapshot, manifest };
}

function cloneManifest(m: ReturnType<typeof build>['manifest']) {
  return JSON.parse(JSON.stringify(m)) as typeof m;
}

function refuse(manifest: unknown, snapshot: unknown, match: RegExp): void {
  assert.throws(() => validateLegacyMediaCandidateManifest(manifest, snapshot as never), match);
}

// 1. exact current canonical snapshot produces exactly 2 legacy candidates
test('the current canonical media shape produces exactly 2 candidates', () => {
  const { manifest } = build();
  assert.equal(manifest.candidateCount, 2);
  assert.equal(manifest.candidates.length, 2);
});

// 2. both expected canonical IDs are represented (in snapshot order)
test('both expected canonical IDs are represented, in snapshot order', () => {
  const { manifest } = build();
  assert.deepEqual(
    manifest.candidates.map((c) => c.canonicalId),
    ['TOBY_T1201_TheValidatorAwakening', 'TOBY_T1203_TheLanguageOfEndurance'],
  );
});

// 3. each candidate preserves the exact legacy img string byte-for-byte
test('legacy img strings are preserved byte-for-byte', () => {
  const { manifest } = build();
  assert.equal(manifest.candidates[0].legacyImgReference, 'https://toadaid.github.io/assets/lore/validator-awakening.jpg');
  assert.equal(manifest.candidates[1].legacyImgReference, 'https://toadaid.github.io/assets/lore/language-of-endurance.jpg');
});

// 4. candidate key is deterministic
test('candidate keys are deterministic and match the legacy-img:<id> form', () => {
  const { manifest } = build();
  assert.equal(manifest.candidates[0].candidateKey, 'legacy-img:TOBY_T1201_TheValidatorAwakening');
  assert.equal(manifest.candidates[1].candidateKey, 'legacy-img:TOBY_T1203_TheLanguageOfEndurance');
});

// 5 + 6. candidate key is NOT named artifactId and contains no canonical artifactId
test('candidate key is not an artifactId and candidates carry no artifactId', () => {
  const { manifest } = build();
  for (const c of manifest.candidates) {
    assert.equal(isValidArtifactId(c.candidateKey), false);
    assert.equal('artifactId' in c, false);
  }
});

// 7. candidate contains no expectedSha256
test('candidates carry no expectedSha256', () => {
  const { manifest } = build();
  for (const c of manifest.candidates) assert.equal('expectedSha256' in c, false);
});

// 8. candidate contains no archivePath
test('candidates carry no archivePath', () => {
  const { manifest } = build();
  for (const c of manifest.candidates) assert.equal('archivePath' in c, false);
});

// 9. candidate state is REFERENCE_ONLY
test('candidate state is REFERENCE_ONLY', () => {
  const { manifest } = build();
  for (const c of manifest.candidates) assert.equal(c.state, 'REFERENCE_ONLY');
});

// 10. candidate type is image
test('candidate type is image', () => {
  const { manifest } = build();
  for (const c of manifest.candidates) assert.equal(c.type, 'image');
});

// 11. provenance exact-match passes
test('a provenance-bound manifest validates against its snapshot', () => {
  const { manifest, snapshot } = build();
  const validated = validateLegacyMediaCandidateManifest(manifest, snapshot);
  assert.equal(validated.candidateCount, 2);
  assert.equal(validated.schemaVersion, LEGACY_MEDIA_CANDIDATE_MANIFEST_SCHEMA_VERSION);
});

// 12-15. wrong provenance refused
test('wrong repository provenance is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest); m.provenance.repository = 'other/repo';
  refuse(m, snapshot, /repository mismatch/);
});
test('wrong source path provenance is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest); m.provenance.path = 'other.json';
  refuse(m, snapshot, /path mismatch/);
});
test('wrong canonical commit provenance is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest); m.provenance.commit = '0'.repeat(40);
  refuse(m, snapshot, /commit mismatch/);
});
test('wrong source digest provenance is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest); m.provenance.sourceDigest = 'sha256:' + '0'.repeat(64);
  refuse(m, snapshot, /sourceDigest mismatch/);
});

// 16. candidateCount mismatch refused
test('candidateCount mismatch is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest); m.candidateCount = 3;
  refuse(m, snapshot, /candidateCount/);
});

// 17. duplicate candidate key refused
test('duplicate candidate keys are refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest);
  m.candidates[1].candidateKey = m.candidates[0].candidateKey;
  refuse(m, snapshot, /duplicate candidateKey/);
});

// 18. candidate canonicalId absent from snapshot refused
test('a candidate canonicalId absent from the snapshot is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest);
  m.candidates[0].canonicalId = 'TOBY_UNKNOWN';
  refuse(m, snapshot, /absent from snapshot/);
});

// 19. candidate legacyImgReference not matching record.canonical.img refused
test('a legacyImgReference that does not match the snapshot img is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest);
  m.candidates[0].legacyImgReference = 'https://toadaid.github.io/assets/lore/wrong.jpg';
  refuse(m, snapshot, /does not match/);
});

// 20. candidate claiming PRESERVED_VERIFIED refused
test('a candidate claiming PRESERVED_VERIFIED is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest);
  (m.candidates[0] as { state: string }).state = 'PRESERVED_VERIFIED';
  refuse(m, snapshot, /state must be 'REFERENCE_ONLY'/);
});

// 21. candidate containing expectedSha256 refused
test('a candidate injecting expectedSha256 is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest);
  (m.candidates[0] as Record<string, unknown>).expectedSha256 = 'sha256:' + 'a'.repeat(64);
  refuse(m, snapshot, /expectedSha256/);
});
test('a candidate injecting artifactId is refused', () => {
  const { manifest, snapshot } = build();
  const m = cloneManifest(manifest);
  (m.candidates[0] as Record<string, unknown>).artifactId = 'TOBY_T1201_TheValidatorAwakening_MEDIA_X';
  refuse(m, snapshot, /artifactId/);
});

// 22. empty-img record generates no candidate
test('an empty-img record generates no candidate', () => {
  const { manifest } = build();
  assert.equal(manifest.candidates.some((c) => c.canonicalId === 'TOBY_T001_FirstRipple'), false);
});

// 23. archive with zero legacy img fields produces a valid zero-candidate manifest
test('an archive with zero legacy img fields produces a valid zero-candidate manifest', () => {
  const zeroFixture = JSON.stringify([
    { id: 'TOBY_A', date: '2024-01-01', title: 'A', comment: 'c', img: '' },
    { id: 'TOBY_B', date: '2024-01-02', title: 'B', comment: 'c' },
  ]);
  const { source, snapshot } = buildSnapshot(zeroFixture, provenance, generatedAt);
  const manifest = buildLegacyMediaCandidateManifest(snapshot.records, source);
  assert.equal(manifest.candidateCount, 0);
  assert.deepEqual(manifest.candidates, []);
  // validates cleanly
  const validated = validateLegacyMediaCandidateManifest(manifest, snapshot);
  assert.equal(validated.candidateCount, 0);
});

// 24. generation is deterministic across repeated builds from identical input
test('generation is deterministic across repeated builds', () => {
  const a = build();
  const b = build();
  assert.deepEqual(a.manifest.candidates, b.manifest.candidates);
  assert.deepEqual(a.manifest.candidateCount, b.manifest.candidateCount);
  assert.deepEqual(a.manifest.provenance.sourceDigest, b.manifest.provenance.sourceDigest);
});

// 25. existing P1 HistoricalArtifact tests remain green — covered by the full
//     npm test run. Here we additionally assert the two contracts coexist:
//     a legacy candidate is structurally distinct from a HistoricalArtifact.
test('legacy candidate remains distinct from authored HistoricalArtifact', () => {
  const { manifest } = build();
  const c = manifest.candidates[0];
  // none of the authored canonical artifact fields are present
  for (const field of ['artifactId', 'expectedSha256', 'archivePath', 'rightsStatus', 'attribution', 'alt', 'caption']) {
    assert.equal(field in c, false, `legacy candidate must not carry authored field ${field}`);
  }
  assert.equal(isValidArtifactId(c.candidateKey), false);
});

// importer self-validation: the manifest built by the real importer path
// validates against its own snapshot (build -> validate -> write).
test('the importer build path self-validates', () => {
  const { manifest, snapshot } = build();
  assert.doesNotThrow(() => validateLegacyMediaCandidateManifest(manifest, snapshot));
});