import fs from 'node:fs';
import { canonicalJson, sha256 } from './integrity.mjs';
import { validateResult } from './validate.mjs';
import { validateReviewResult } from './review-validation.mjs';

export function preflightAdjudicationRun(state) {
  if (state?.status !== 'succeeded' || !state?.review) {
    throw new Error('A Codex adjudication requires a successful validated review run.');
  }
}

export function reviewManifestPath(state) {
  preflightAdjudicationRun(state);
  if (typeof state.review.manifest_path !== 'string' || !state.review.manifest_path.trim()) {
    throw new Error('A Codex adjudication requires a successful validated review run.');
  }
  return state.review.manifest_path;
}

export function preflightAdjudication(state, packet) {
  preflightAdjudicationRun(state);
  if (packet?.valid !== true || !packet.manifest || !packet.manifest_sha256) {
    throw new Error('A Codex adjudication requires a currently valid review packet.');
  }
  const manifest = packet.manifest;
  if (state.review.packet_id !== manifest?.packet_id) throw new Error('Run and packet IDs do not match.');
  if (state.review.manifest_sha256 !== packet.manifest_sha256) {
    throw new Error('Run and packet manifest hashes do not match.');
  }
  const schemaValidation = validateResult(state.result);
  if (!schemaValidation.valid) {
    throw new Error(`Stored delegated result fails schema validation: ${schemaValidation.errors.join('; ')}`);
  }
  const attestationValidation = validateReviewResult(state.result, manifest);
  if (!attestationValidation.valid) {
    throw new Error(`Stored review result fails source attestation validation: ${attestationValidation.errors.join('; ')}`);
  }
  return { manifest, attestationValidation };
}

export function buildAdjudication(state, packet, outputPath) {
  const { manifest, attestationValidation } = preflightAdjudication(state, packet);
  const findings = Array.isArray(state.result?.findings) ? state.result.findings : [];
  const artifact = {
    adjudication_version: 1,
    status: 'pending_codex_review',
    authority: 'Codex adjudication artefact; delegated AG findings are not accepted truth.',
    run_id: state.run_id,
    model: state.model,
    packet_id: manifest.packet_id,
    bindings: {
      packet_manifest_sha256: packet.manifest_sha256,
      ag_result_sha256: sha256(canonicalJson(state.result)),
    },
    metrics: {
      elapsed_ms: Math.max(0, Date.parse(state.ended_at) - Date.parse(state.started_at)),
      total_tokens: state.usage?.total_tokens ?? null,
      usage: state.usage || null,
      attested_source_count: attestationValidation.attested_sources.length,
      finding_count: findings.length,
    },
    delegated_findings: findings.map((finding, index) => ({
      finding_number: index + 1,
      finding_sha256: sha256(canonicalJson(finding)),
      ag_finding: finding,
      codex_decision: 'unresolved',
      codex_rationale: null,
      codex_evidence: [],
    })),
  };
  if (outputPath) {
    fs.writeFileSync(outputPath, canonicalJson(artifact), { mode: 0o600, flag: 'wx' });
  }
  return artifact;
}
