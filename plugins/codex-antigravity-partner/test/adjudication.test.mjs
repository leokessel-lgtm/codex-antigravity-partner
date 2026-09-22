import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildAdjudication } from '../src/adjudication.mjs';
import { canonicalJson, sha256 } from '../src/integrity.mjs';
import { buildReviewPacket } from '../src/review-packet.mjs';

const sourceSha = 'a'.repeat(64);
const manifest = { packet_id: 'packet-a', files: [{ path: 'source/a.md', sha256: sourceSha, bytes: 1 }] };
const packet = { valid: true, manifest, manifest_sha256: sha256(canonicalJson(manifest)) };

function validState() {
  return {
    run_id: 'run-1', model: 'gemini-test-pro', status: 'succeeded',
    started_at: '2026-09-14T00:00:00.000Z', ended_at: '2026-09-14T00:01:00.000Z',
    usage: { total_tokens: 42 },
    review: { manifest_sha256: packet.manifest_sha256, packet_id: 'packet-a' },
    attestation_validation: { valid: true, evidence_kind: 'validated_model_attestation' },
    result: {
      status: 'completed', summary: 'Delegated review', changed_files: [], checks: [], risks: [], needs_user_action: false,
      findings: [{
        title: 'Delegated claim', claim: 'A claim', classification: 'observed', confidence: 'high',
        evidence: [{ source: 'source/a.md', locator: 'L1', basis: 'A' }], implication: 'I', next_step: 'N',
      }],
      source_attestations: [{ source: 'source/a.md', sha256: sourceSha, basis: 'Consulted.' }],
    },
  };
}

test('creates a deterministic separate adjudication with every AG finding unresolved', () => {
  const state = validState();
  const first = buildAdjudication(state, packet);
  const second = buildAdjudication(state, packet);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'pending_codex_review');
  assert.equal(first.delegated_findings[0].codex_decision, 'unresolved');
  assert.equal(first.delegated_findings[0].codex_rationale, null);
  assert.equal(first.metrics.elapsed_ms, 60_000);
  assert.equal(first.metrics.total_tokens, 42);
  assert.notEqual(first.bindings.ag_result_sha256, first.bindings.packet_manifest_sha256);
});

test('fails closed for packet, manifest, schema and attestation tampering', () => {
  assert.throws(() => buildAdjudication({ status: 'failed' }, packet), /successful validated review/i);
  assert.throws(() => buildAdjudication(validState(), { ...packet, valid: false }), /currently valid review packet/i);
  assert.throws(() => buildAdjudication(validState(), { ...packet, manifest_sha256: 'b'.repeat(64) }), /hashes do not match/i);
  assert.throws(() => buildAdjudication({ ...validState(), result: { source_attestations: validState().result.source_attestations } }, packet), /schema validation/i);
  const badAttestation = validState();
  badAttestation.result.source_attestations[0].sha256 = 'b'.repeat(64);
  assert.throws(() => buildAdjudication(badAttestation, packet), /source attestation validation/i);
});

test('never overwrites an existing adjudication artefact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partner-adjudication-'));
  const output = path.join(root, 'adjudication.json');
  fs.writeFileSync(output, '{}\n');
  assert.throws(() => buildAdjudication(validState(), packet, output), /EEXIST|exist/i);
  assert.equal(fs.readFileSync(output, 'utf8'), '{}\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('offline adjudication CLI revalidates current packet bytes before writing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partner-adjudication-cli-'));
  const repositoryRoot = path.join(root, 'repository');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'a.md'), 'a');
  const built = buildReviewPacket({
    version: 1, packet_id: 'packet-a', repository_root: repositoryRoot, source_root: repositoryRoot, files: ['a.md'],
    project: { project_id: 'offline-review', sensitivity: 'normal', max_runtime_seconds: 10 },
  }, path.join(root, 'packets'));
  const state = validState();
  state.review.manifest_sha256 = built.manifest_sha256;
  state.result.source_attestations[0].sha256 = built.manifest.files[0].sha256;
  const statePath = path.join(root, 'state.json');
  fs.writeFileSync(statePath, canonicalJson(state));
  const packetSource = path.join(built.packet_root, 'source', 'a.md');
  fs.chmodSync(built.packet_root, 0o700);
  fs.chmodSync(path.dirname(packetSource), 0o700);
  fs.chmodSync(packetSource, 0o600);
  fs.appendFileSync(packetSource, 'tampered');
  const output = path.join(root, 'adjudication.json');
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'bin', 'create-adjudication.mjs'), statePath, built.manifest_path, output,
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.equal(fs.existsSync(output), false);
  const makeWritable = (target) => {
    try {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) makeWritable(child);
        else if (!entry.isSymbolicLink()) fs.chmodSync(child, 0o600);
      }
      fs.chmodSync(target, 0o700);
    } catch { /* absent */ }
  };
  makeWritable(root);
  fs.rmSync(root, { recursive: true, force: true });
});
