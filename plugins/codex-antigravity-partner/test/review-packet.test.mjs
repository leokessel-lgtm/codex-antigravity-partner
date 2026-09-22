import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildReviewPacket, verifyReviewPacket } from '../src/review-packet.mjs';

const buildPacketCli = fileURLToPath(new URL('../bin/build-review-packet.mjs', import.meta.url));

const roots = [];
function makeRemovable(target) {
  try {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) makeRemovable(child);
      else if (!entry.isSymbolicLink()) fs.chmodSync(child, 0o600);
    }
    fs.chmodSync(target, 0o700);
  } catch { /* already absent */ }
}
afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    makeRemovable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partner-packet-'));
  roots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  const sourceRoot = path.join(repositoryRoot, 'project');
  const outputParent = path.join(root, 'packets');
  fs.mkdirSync(path.join(sourceRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'authority first\n');
  fs.writeFileSync(path.join(sourceRoot, 'docs', 'finding.md'), 'bounded evidence\n');
  const spec = {
    version: 1,
    packet_id: 'test-packet',
    repository_root: repositoryRoot,
    source_root: sourceRoot,
    files: ['README.md', 'docs/finding.md'],
    project: {
      project_id: 'packet-review',
      sensitivity: 'normal',
      max_runtime_seconds: 120,
      allowed_models: ['gemini-test-pro'],
    },
  };
  return { root, repositoryRoot, sourceRoot, outputParent, spec };
}

test('builds a no-overwrite packet with canonical hashes and sandbox-only project configuration', () => {
  const { outputParent, spec } = fixture();
  const built = buildReviewPacket(spec, outputParent);
  assert.equal(built.manifest.packet_id, 'test-packet');
  assert.equal(built.manifest.files.length, 2);
  assert.deepEqual(built.manifest.files.map((entry) => entry.path), ['source/README.md', 'source/docs/finding.md']);
  assert.equal(verifyReviewPacket(built.manifest_path).valid, true);
  assert.equal(fs.readFileSync(path.join(built.packet_root, 'source', 'README.md'), 'utf8'), 'authority first\n');
  const config = fs.readFileSync(path.join(built.packet_root, '.agent-collab', 'project.yaml'), 'utf8');
  assert.match(config, /allowed_permissions:\n  - sandbox/);
  assert.doesNotMatch(config, /accept-edits|allow_unattended_approval: true/);
  assert.throws(() => buildReviewPacket(spec, outputParent), /already exists/);
  const manifestBytes = fs.readFileSync(built.manifest_path);
  assert.equal(crypto.createHash('sha256').update(manifestBytes).digest('hex'), built.manifest_sha256);
});

test('packet build output makes unattended review readiness explicit before a run starts', () => {
  const { root, outputParent, spec } = fixture();
  const specPath = path.join(root, 'packet-spec.yaml');
  spec.packet_id = 'grant-eligible-packet';
  spec.project.allow_unattended_approval = true;
  fs.writeFileSync(specPath, yaml.dump(spec));
  const output = JSON.parse(execFileSync(process.execPath, [buildPacketCli, specPath, outputParent], { encoding: 'utf8' }));
  assert.equal(output.unattended_approval_eligible, true);
  assert.equal(output.review_access_state, 'eligible_for_grant');
  assert.match(output.review_access_message, /exact manifest.*single-use grant/i);
});

test('packet build output marks an ineligible review for rebuild before start_run', () => {
  const { root, outputParent, spec } = fixture();
  const specPath = path.join(root, 'packet-spec.yaml');
  spec.packet_id = 'ineligible-packet';
  spec.project.allow_unattended_approval = false;
  fs.writeFileSync(specPath, yaml.dump(spec));
  const output = JSON.parse(execFileSync(process.execPath, [buildPacketCli, specPath, outputParent], { encoding: 'utf8' }));
  assert.equal(output.unattended_approval_eligible, false);
  assert.equal(output.review_access_state, 'requires_eligible_rebuild');
  assert.match(output.review_access_message, /controller will reject review mode.*rebuild/i);
});

test('rejects paths outside the source root, directories, symlinks and duplicate destinations', () => {
  const { root, sourceRoot, outputParent, spec } = fixture();
  fs.writeFileSync(path.join(root, 'outside.md'), 'outside\n');
  fs.symlinkSync(path.join(root, 'outside.md'), path.join(sourceRoot, 'link.md'));
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'escape', files: ['../outside.md'] }, outputParent), /escape|within the source root/i);
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'directory', files: ['docs'] }, outputParent), /regular file/i);
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'symlink', files: ['link.md'] }, outputParent), /symlink/i);
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'duplicate', files: ['README.md', './README.md'] }, outputParent), /duplicate/i);
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'missing', files: ['missing.md'] }, outputParent), /ENOENT|does not exist/i);
});

test('rejects a parent path swapped to an outside symlink between validation and open', () => {
  const { root, sourceRoot, outputParent, spec } = fixture();
  const outside = path.join(root, 'outside-dir');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'finding.md'), 'outside secret\n');
  let swapped = false;
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'path-race', files: ['docs/finding.md'] }, outputParent, {
    beforeOpen(relativePath) {
      if (!swapped && relativePath === 'docs/finding.md') {
        swapped = true;
        fs.renameSync(path.join(sourceRoot, 'docs'), path.join(sourceRoot, 'docs-original'));
        fs.symlinkSync(outside, path.join(sourceRoot, 'docs'));
      }
    },
  }), /identity changed|path changed|symlink/i);
  assert.equal(fs.existsSync(path.join(outputParent, 'path-race')), false);
});

test('rejects output inside the repository and removes a partial packet when a source changes during copy', () => {
  const { repositoryRoot, sourceRoot, outputParent, spec } = fixture();
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'inside' }, path.join(repositoryRoot, 'packets')), /outside the repository/i);
  assert.throws(() => buildReviewPacket({ ...spec, packet_id: 'raced' }, outputParent, {
    afterCopy(relativePath) {
      if (relativePath === 'README.md') fs.appendFileSync(path.join(sourceRoot, relativePath), 'changed\n');
    },
  }), /changed while the packet was being built/i);
  assert.equal(fs.existsSync(path.join(outputParent, 'raced')), false);
});

test('rejects project configuration fields that could widen packet access', () => {
  const { outputParent, spec } = fixture();
  assert.throws(() => buildReviewPacket({
    ...spec,
    packet_id: 'widened',
    project: { ...spec.project, allowed_permissions: ['accept-edits'] },
  }, outputParent), /unsupported project field|widen/i);
});
