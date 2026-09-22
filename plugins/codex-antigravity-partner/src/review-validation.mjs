const LIMITATION = 'Validated model source attestations are claims checked against the packet manifest; they are not filesystem or kernel-level file-read telemetry.';

export function validateReviewResult(result, manifest) {
  const errors = [];
  const entries = new Map((manifest?.files || []).map((entry) => [entry.path, entry]));
  const attestations = Array.isArray(result?.source_attestations) ? result.source_attestations : [];
  const attested = new Map();
  if (attestations.length === 0) errors.push('A review result must contain at least one source attestation.');
  for (const attestation of attestations) {
    if (attested.has(attestation.source)) errors.push(`Duplicate source attestation: ${attestation.source}`);
    const expected = entries.get(attestation.source);
    if (!expected) errors.push(`Attested source is absent from the packet manifest: ${attestation.source}`);
    else if (attestation.sha256 !== expected.sha256) errors.push(`Attested hash does not match the packet manifest: ${attestation.source}`);
    attested.set(attestation.source, attestation);
  }
  for (const finding of result?.findings || []) {
    for (const evidence of finding.evidence || []) {
      if (!entries.has(evidence.source)) errors.push(`Finding citation is absent from the packet manifest: ${evidence.source}`);
      else if (!attested.has(evidence.source)) errors.push(`Finding citation is not source-attested: ${evidence.source}`);
    }
  }
  return {
    valid: errors.length === 0,
    evidence_kind: 'validated_model_attestation',
    limitation: LIMITATION,
    attested_sources: [...attested.keys()].sort(),
    errors,
  };
}
