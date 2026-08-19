import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateHistoricalArtifact,
  isValidArtifactId,
  isValidArtifactDigest,
  isArtifactType,
  isArtifactRole,
  isArtifactRightsStatus,
  deriveAdmissionState,
  type HistoricalArtifact,
} from '../src/lib/lore/canonical-schema.ts';

const GOOD_DIGEST = 'sha256:8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f984';
const GOOD_ID = 'TOBY_T1201_TheValidatorAwakening_MEDIA_ValidatorAwakeningPlate';

/** A minimal valid authored contract (reference-only: no expected digest). */
function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifactId: GOOD_ID,
    type: 'image',
    role: 'original-post-media',
    sourceUrl: 'https://toadaid.github.io/assets/lore/validator-awakening.jpg',
    rightsStatus: 'unknown',
    ...overrides,
  };
}

function refuse(input: unknown, match: RegExp): void {
  assert.throws(() => validateHistoricalArtifact(input), match);
}

// 1. valid explicitly-authored artifact ID accepted
test('a valid explicitly-authored artifact ID is accepted', () => {
  const a = validateHistoricalArtifact(base());
  assert.equal(a.artifactId, GOOD_ID);
  assert.equal(isValidArtifactId(GOOD_ID), true);
});

// 2. malformed artifact ID rejected
test('malformed artifact IDs are rejected', () => {
  for (const badId of [
    'TOBY_T1201_TheValidatorAwakening', // no _MEDIA_ separator
    'TOBY_T1201_TheValidatorAwakening_MEDIA_', // empty slug
    'TOBY_MEDIA_Slug', // prefix has only one segment
    'TOBY_T1201_TheValidatorAwakening_MEDIA_Slug_Extra', // slug has underscore (not in [A-Za-z0-9-])
    'TOBY_T1201_TheValidatorAwakening_MEDIA_Slug With Space', // slug has space
    'TOBY_T1201_TheValidatorAwakening_media_Slug', // lowercase separator rejected (case-sensitive _MEDIA_)
    '', // empty
    42, // non-string
    'TOBY_T1201_TheValidatorAwakening_MEDIA_A_MEDIA_B', // two separators
  ]) {
    assert.equal(isValidArtifactId(badId), false, `expected invalid: ${String(badId)}`);
    refuse({ ...base(), artifactId: badId }, /artifactId/);
  }
});

// 3. ordinal/index identity is not generated anywhere by helper behavior
test('ordinal/index identity is rejected, and no helper generates it', () => {
  // Pure-integer slug is ordinal identity and is structurally rejected.
  assert.equal(isValidArtifactId('TOBY_T1201_TheValidatorAwakening_MEDIA_001'), false);
  assert.equal(isValidArtifactId('TOBY_T1201_TheValidatorAwakening_MEDIA_1'), false);
  refuse({ ...base(), artifactId: 'TOBY_T1201_TheValidatorAwakening_MEDIA_001' }, /artifactId/);
  // There is no function in the contract module that synthesizes ids from
  // array position; the only id helper is a predicate. A non-ordinal slug with
  // the same record stays valid regardless of other artifacts.
  assert.equal(
    isValidArtifactId('TOBY_T1201_TheValidatorAwakening_MEDIA_ValidatorAwakeningPlate'),
    true,
  );
});

// 4. expectedSha256 absent is valid for a reference-only contract
test('expectedSha256 absent is valid (reference-only)', () => {
  const a = validateHistoricalArtifact(base());
  assert.equal(a.expectedSha256, undefined);
  assert.equal(deriveAdmissionState(a), 'REFERENCE_ONLY');
});

// 5. valid sha256:<64 lowercase hex> accepted
test('a valid sha256:<64 lowercase hex> digest is accepted', () => {
  assert.equal(isValidArtifactDigest(GOOD_DIGEST), true);
  const a = validateHistoricalArtifact({ ...base(), expectedSha256: GOOD_DIGEST, rightsStatus: 'cleared' });
  assert.equal(a.expectedSha256, GOOD_DIGEST);
});

// 6. malformed digest rejected
test('malformed digests are rejected', () => {
  for (const bad of [
    '8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f984', // no prefix
    'sha256:8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f', // too short
    'sha256:8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f9848635', // too long
    'sha256:8635376f18805eb0677cdcfce92e8b63ce8d6f530c1fcab06e4f1348f323f98z', // non-hex (z), 64 chars
  ]) {
    assert.equal(isValidArtifactDigest(bad), false, `expected invalid digest: ${bad}`);
    refuse({ ...base(), expectedSha256: bad }, /expectedSha256/);
  }
});

// 7. uppercase / short / malformed digest handling is exact and documented
test('uppercase hex is rejected; only lowercase is canonical', () => {
  const upper = 'sha256:8635376F18805EB0677CDCFCF92E8B63CE8D6F530C1FCAB06E4F1348F323F984';
  assert.equal(isValidArtifactDigest(upper), false);
  refuse({ ...base(), expectedSha256: upper }, /expectedSha256/);
  // exact-length lowercase passes (re-stated for precision)
  assert.equal(isValidArtifactDigest(GOOD_DIGEST), true);
});

// 8. type and role are separate axes
test('type and role are separate axes and do not share vocabulary', () => {
  // screenshot is a role, not a type
  assert.equal(isArtifactType('screenshot'), false);
  assert.equal(isArtifactRole('screenshot'), true);
  // image is a type, not a role
  assert.equal(isArtifactType('image'), true);
  assert.equal(isArtifactRole('image'), false);
  refuse({ ...base(), type: 'screenshot' }, /type/);
  refuse({ ...base(), role: 'image' }, /role/);
  // both axes together accepted
  const a = validateHistoricalArtifact({ ...base(), type: 'video', role: 'screenshot' });
  assert.equal(a.type, 'video');
  assert.equal(a.role, 'screenshot');
});

// 9. rightsStatus allowed values are exact
test('rightsStatus accepts exactly the four allowed values', () => {
  for (const ok of ['unknown', 'cleared', 'restricted', 'public-domain']) {
    assert.equal(isArtifactRightsStatus(ok), true);
    const a = validateHistoricalArtifact({ ...base(), rightsStatus: ok });
    assert.equal(a.rightsStatus, ok);
  }
  for (const bad of ['cleared2', 'UNKNOWN', '', 'maybe', 'public', 'domain']) {
    assert.equal(isArtifactRightsStatus(bad), false);
    refuse({ ...base(), rightsStatus: bad }, /rightsStatus/);
  }
});

// 10. unknown rights posture preserved
test('unknown rights posture is preserved and is the fail-closed default', () => {
  const a = validateHistoricalArtifact(base()); // rightsStatus: unknown
  assert.equal(a.rightsStatus, 'unknown');
});

// 11. archivePath / sourceUrl remain distinct fields
test('sourceUrl and archivePath are distinct fields and may both be present', () => {
  const a = validateHistoricalArtifact({
    ...base(),
    sourceUrl: 'https://x.com/toadgod1017/status/1987779173637898316',
    archivePath: 'assets/lore/validator-awakening.jpg',
  });
  assert.equal(a.sourceUrl, 'https://x.com/toadgod1017/status/1987779173637898316');
  assert.equal(a.archivePath, 'assets/lore/validator-awakening.jpg');
  assert.notEqual(a.sourceUrl, a.archivePath);
  // archivePath must be a relative posix-style locator (no absolute, no backslash)
  refuse({ ...base(), archivePath: '/assets/lore/x.jpg' }, /archivePath/);
  refuse({ ...base(), archivePath: 'C:\\assets\\lore\\x.jpg' }, /archivePath/);
});

// 12. authored contract does not contain runtime admissionState
test('authored contract rejects runtime admissionState', () => {
  refuse({ ...base(), admissionState: 'PRESERVED_VERIFIED' }, /admissionState/);
});

// 13. authored contract does not contain effective offline cache state
test('authored contract rejects effective offline cache state', () => {
  refuse({ ...base(), effectiveOfflineEligible: true }, /effectiveOfflineEligible/);
  refuse({ ...base(), effectiveOfflineEligible: false }, /effectiveOfflineEligible/);
});

// additional: the validator rejects every other derived/runtime field too
test('authored contract rejects all derived/runtime metadata fields', () => {
  for (const field of ['observedSha256', 'mimeType', 'byteSize', 'width', 'height', 'duration']) {
    refuse({ ...base(), [field]: 'x' }, new RegExp(field));
  }
});

// additional: rightsStatus is required (not optional in practice)
test('rightsStatus is required', () => {
  const { rightsStatus: _omit, ...withoutRights } = base();
  void _omit;
  refuse(withoutRights, /rightsStatus/);
});

// additional: non-object / array input rejected
test('non-object and array inputs are rejected', () => {
  refuse(null, /not an object/);
  refuse('string', /not an object/);
  refuse([], /not an object/);
});

// digest-law semantics (governor override): the four required paths
test('digest-law admission semantics are exact', () => {
  const expected = GOOD_DIGEST;
  const preserved: HistoricalArtifact = {
    artifactId: GOOD_ID,
    type: 'image',
    role: 'original-post-media',
    sourceUrl: 'https://toadaid.github.io/assets/lore/validator-awakening.jpg',
    archivePath: 'assets/lore/validator-awakening.jpg',
    expectedSha256: expected,
    rightsStatus: 'cleared',
  };
  // expected digest absent -> REFERENCE_ONLY
  assert.equal(deriveAdmissionState({ ...preserved, expectedSha256: undefined }), 'REFERENCE_ONLY');
  // expected digest present + bytes unavailable -> MISSING
  assert.equal(deriveAdmissionState(preserved, { available: false }), 'MISSING');
  assert.equal(deriveAdmissionState(preserved, undefined), 'MISSING');
  // expected digest present + observed mismatch -> DIGEST_MISMATCH
  assert.equal(
    deriveAdmissionState(preserved, { available: true, observedSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }),
    'DIGEST_MISMATCH',
  );
  assert.equal(deriveAdmissionState(preserved, { available: true }), 'DIGEST_MISMATCH'); // no observed digest
  // expected digest present + exact match -> PRESERVED_VERIFIED
  assert.equal(deriveAdmissionState(preserved, { available: true, observedSha256: expected }), 'PRESERVED_VERIFIED');
  // unsupported type while otherwise matching
  assert.equal(
    deriveAdmissionState(preserved, { available: true, observedSha256: expected, supportedType: false }),
    'UNSUPPORTED_MEDIA',
  );
});

// digest-law: rights gate — unknown/restricted with a preservation claim
test('unknown/restricted rights with a preservation claim are not admitted', () => {
  const claimed: HistoricalArtifact = {
    artifactId: GOOD_ID,
    type: 'image',
    role: 'original-post-media',
    sourceUrl: 'https://toadaid.github.io/assets/lore/validator-awakening.jpg',
    expectedSha256: GOOD_DIGEST,
    rightsStatus: 'unknown',
  };
  assert.equal(deriveAdmissionState(claimed, { available: true, observedSha256: GOOD_DIGEST }), 'RIGHTS_NOT_ADMITTED');
  assert.equal(
    deriveAdmissionState({ ...claimed, rightsStatus: 'restricted' }, { available: true, observedSha256: GOOD_DIGEST }),
    'RIGHTS_NOT_ADMITTED',
  );
  // reference-only (no digest) stays REFERENCE_ONLY regardless of rights
  assert.equal(deriveAdmissionState({ ...claimed, expectedSha256: undefined }), 'REFERENCE_ONLY');
});