import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReviewResult } from '../src/review-validation.mjs';

const manifest = {
  packet_id: 'packet-a',
  files: [
    { path: 'source/a.md', sha256: 'a'.repeat(64), bytes: 10 },
    { path: 'source/b.md', sha256: 'b'.repeat(64), bytes: 20 },
  ],
};

function result(overrides = {}) {
  return {
    findings: [{ evidence: [{ source: 'source/a.md', locator: 'L1', basis: 'Exact text.' }] }],
    source_attestations: [{ source: 'source/a.md', sha256: 'a'.repeat(64), basis: 'Consulted for finding 1.' }],
    ...overrides,
  };
}

test('accepts manifest-bound model attestations and clearly labels their evidence limit', () => {
  const checked = validateReviewResult(result(), manifest);
  assert.equal(checked.valid, true);
  assert.equal(checked.evidence_kind, 'validated_model_attestation');
  assert.match(checked.limitation, /not filesystem or kernel-level file-read telemetry/i);
});

test('rejects missing, unknown, duplicate and hash-mismatched attestations', () => {
  assert.equal(validateReviewResult(result({ source_attestations: [] }), manifest).valid, false);
  assert.equal(validateReviewResult(result({ source_attestations: [{ source: 'source/x.md', sha256: 'a'.repeat(64), basis: 'x' }] }), manifest).valid, false);
  assert.equal(validateReviewResult(result({ source_attestations: [
    { source: 'source/a.md', sha256: 'a'.repeat(64), basis: 'one' },
    { source: 'source/a.md', sha256: 'a'.repeat(64), basis: 'two' },
  ] }), manifest).valid, false);
  assert.equal(validateReviewResult(result({ source_attestations: [{ source: 'source/a.md', sha256: 'b'.repeat(64), basis: 'wrong' }] }), manifest).valid, false);
});

test('rejects finding citations that are absent from the manifest or not attested', () => {
  const unknownCitation = result({ findings: [{ evidence: [{ source: 'source/x.md', locator: 'L1', basis: 'x' }] }] });
  assert.equal(validateReviewResult(unknownCitation, manifest).valid, false);
  const unattestedCitation = result({ findings: [{ evidence: [{ source: 'source/b.md', locator: 'L1', basis: 'b' }] }] });
  assert.equal(validateReviewResult(unattestedCitation, manifest).valid, false);
});
