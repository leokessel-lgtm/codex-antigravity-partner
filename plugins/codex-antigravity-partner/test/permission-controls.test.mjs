import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { buildReviewPacket } from '../src/review-packet.mjs';
import { startRun } from '../src/runner.mjs';
import { readState, TERMINAL_STATES } from '../src/state.mjs';
import { createUnattendedGrant, consumeUnattendedGrant } from '../src/unattended-grant.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fakeAgy = path.join(testDir, 'fixtures', 'fake-agy.mjs');
const roots = [];

function makeWritable(target) {
  try {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) makeWritable(child);
      else if (!entry.isSymbolicLink()) fs.chmodSync(child, 0o600);
    }
    fs.chmodSync(target, 0o700);
  } catch { /* absent or already removable */ }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture({ packetId = 'permission-packet', evidence = 'evidence\n', allowUnattended = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-permission-'));
  roots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), evidence);
  const built = buildReviewPacket({
    version: 1,
    packet_id: packetId,
    repository_root: repositoryRoot,
    source_root: repositoryRoot,
    files: ['evidence.md'],
    project: {
      project_id: packetId,
      sensitivity: 'normal',
      max_runtime_seconds: 10,
      allow_unattended_approval: allowUnattended,
      allowed_models: ['gemini-test-pro'],
    },
  }, path.join(root, 'packets'));
  return { root, stateDir, built };
}

function options(fx, prompt, extra = {}) {
  return {
    configPath: path.join(fx.built.packet_root, '.agent-collab', 'project.yaml'),
    prompt,
    model: 'gemini-test-pro',
    modelRationale: 'Fixture model for permission-control regression coverage.',
    permission: 'sandbox',
    reviewMode: true,
    reviewManifestPath: fx.built.manifest_path,
    agyCli: fakeAgy,
    stateDir: fx.stateDir,
    ...extra,
  };
}

async function waitForTerminal(stateDir, runId, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readState(stateDir, runId);
    if (state && TERMINAL_STATES.has(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readState(stateDir, runId);
}

test('review mode rejects an ineligible manifest-bound configuration before spawn', () => {
  const fx = fixture({ packetId: 'ineligible-review' });
  assert.throws(
    () => startRun(options(fx, '[valid-review]')),
    /not eligible.*rebuild.*fresh explicit approval/i,
  );
  const states = fs.existsSync(fx.stateDir)
    ? fs.readdirSync(fx.stateDir).filter((name) => name.endsWith('.json'))
    : [];
  assert.deepEqual(states, []);
});

test('read denial becomes a permission_blocked terminal state for invalid and failed AG output', async () => {
  assert.equal(TERMINAL_STATES.has('permission_blocked'), true);
  for (const prompt of ['[denied-read-invalid]', '[denied-read-failed]']) {
    const fx = fixture({ packetId: `read-denial-${prompt.includes('invalid') ? 'invalid' : 'failed'}`, allowUnattended: true });
    const started = startRun(options(fx, prompt));
    const state = await waitForTerminal(fx.stateDir, started.run_id);
    assert.equal(state.status, 'permission_blocked');
    assert.equal(state.reason_code, 'read_permission_denied');
    assert.equal(state.denied_action_class, 'read');
    assert.equal(state.retryable, false);
    assert.match(state.required_change, /unattended approval|packet|scope/i);
  }
});

test('non-file and unnamed denials retain the ordinary invalid_result classification', async () => {
  for (const prompt of [
    '[denied-write-only]',
    '[denied-url-only]',
    '[denied-command-only]',
    '[denied-missing-action]',
  ]) {
    const fx = fixture({ packetId: `non-read-${prompt.replaceAll(/[^a-z]+/gu, '-')}`, allowUnattended: true });
    const started = startRun(options(fx, prompt));
    const state = await waitForTerminal(fx.stateDir, started.run_id);
    assert.equal(state.status, 'invalid_result', prompt);
    assert.equal(Object.hasOwn(state, 'reason_code'), false, prompt);
    assert.equal(Object.hasOwn(state, 'denied_action_class'), false, prompt);
  }
});

test('an identical review retry is suppressed before spawn but a different manifest is allowed', async () => {
  const first = fixture({ packetId: 'same-review', allowUnattended: true });
  const started = startRun(options(first, '[denied-read-invalid]'));
  await waitForTerminal(first.stateDir, started.run_id);
  assert.throws(
    () => startRun(options(first, '[denied-read-invalid]')),
    /identical retry.*permission.*blocked|permission.*blocked.*prior run/i,
  );

  const second = fixture({ packetId: 'different-review', evidence: 'different evidence\n', allowUnattended: true });
  fs.mkdirSync(second.stateDir, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(first.stateDir)) {
    if (name.endsWith('.json')) fs.copyFileSync(path.join(first.stateDir, name), path.join(second.stateDir, name));
  }
  const different = startRun(options(second, '[denied-read-invalid]'));
  assert.equal(typeof different.run_id, 'string');
  await waitForTerminal(second.stateDir, different.run_id);
});

test('permission-blocked history does not suppress non-review runs', async () => {
  const fx = fixture({ allowUnattended: true });
  const first = startRun(options(fx, '[denied-read-invalid]'));
  await waitForTerminal(fx.stateDir, first.run_id);
  const nonReview = startRun({
    ...options(fx, '[denied-read-invalid]'),
    reviewMode: false,
    reviewManifestPath: undefined,
  });
  assert.equal(typeof nonReview.run_id, 'string');
  await waitForTerminal(fx.stateDir, nonReview.run_id);
});

test('single-use grant is owner-only, manifest-bound, model-bound and atomically consumed', () => {
  const fx = fixture({ allowUnattended: true });
  const grant = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  assert.equal(fs.statSync(path.join(fx.stateDir, 'grants')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(grant.grant_path).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(grant).includes('evidence'), false);
  assert.throws(() => consumeUnattendedGrant({
    stateDir: fx.stateDir,
    grantId: grant.grant.grant_id,
    manifestSha256: 'a'.repeat(64),
    model: 'gemini-test-pro',
    permission: 'sandbox',
  }), /manifest/i);
  const consumed = consumeUnattendedGrant({
    stateDir: fx.stateDir,
    grantId: grant.grant.grant_id,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
  });
  assert.equal(consumed.consumed, true);
  assert.throws(() => consumeUnattendedGrant({
    stateDir: fx.stateDir,
    grantId: grant.grant.grant_id,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
  }), /consumed|not available/i);
});

test('expired or mismatched grants fail closed without becoming reusable', () => {
  const fx = fixture({ allowUnattended: true });
  const wrongModel = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  assert.throws(() => consumeUnattendedGrant({
    stateDir: fx.stateDir,
    grantId: wrongModel.grant.grant_id,
    manifestSha256: fx.built.manifest_sha256,
    model: 'different-model',
    permission: 'sandbox',
  }), /model/i);

  const expired = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  const record = JSON.parse(fs.readFileSync(expired.grant_path, 'utf8'));
  record.expires_at = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(expired.grant_path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => consumeUnattendedGrant({
    stateDir: fx.stateDir,
    grantId: expired.grant.grant_id,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
  }), /expired/i);
});

test('review-mode unattended approval requires and consumes an exact grant', async () => {
  const fx = fixture({ allowUnattended: true });
  assert.throws(
    () => startRun(options(fx, '[valid-review]', { unattendedApproval: true })),
    /grant/i,
  );
  const grant = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  const started = startRun(options(fx, '[valid-review]', {
    unattendedApproval: true,
    unattendedGrantId: grant.grant.grant_id,
  }));
  const state = await waitForTerminal(fx.stateDir, started.run_id);
  assert.equal(state.status, 'succeeded');
  assert.equal(state.unattended_grant_id, grant.grant.grant_id);
  assert.throws(() => startRun(options(fx, '[valid-review]', {
    unattendedApproval: true,
    unattendedGrantId: grant.grant.grant_id,
  })), /consumed|not available/i);
});

test('changed unattended authority bypasses a prior non-unattended permission block', async () => {
  const fx = fixture({ allowUnattended: true });
  const blocked = startRun(options(fx, '[denied-read-invalid]'));
  assert.equal((await waitForTerminal(fx.stateDir, blocked.run_id)).status, 'permission_blocked');
  const grant = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  const changedAuthority = startRun(options(fx, '[valid-review]', {
    unattendedApproval: true,
    unattendedGrantId: grant.grant.grant_id,
  }));
  assert.equal((await waitForTerminal(fx.stateDir, changedAuthority.run_id)).status, 'succeeded');
});

test('a fresh grant bypasses a prior unattended permission block for the same packet', async () => {
  const fx = fixture({ allowUnattended: true });
  const firstGrant = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  const blocked = startRun(options(fx, '[denied-read-invalid]', {
    unattendedApproval: true,
    unattendedGrantId: firstGrant.grant.grant_id,
  }));
  assert.equal((await waitForTerminal(fx.stateDir, blocked.run_id)).status, 'permission_blocked');

  const freshGrant = createUnattendedGrant({
    stateDir: fx.stateDir,
    manifestSha256: fx.built.manifest_sha256,
    model: 'gemini-test-pro',
    permission: 'sandbox',
    ttlSeconds: 600,
  });
  const retried = startRun(options(fx, '[valid-review]', {
    unattendedApproval: true,
    unattendedGrantId: freshGrant.grant.grant_id,
  }));
  const final = await waitForTerminal(fx.stateDir, retried.run_id);
  assert.equal(final.status, 'succeeded');
  assert.equal(final.unattended_grant_id, freshGrant.grant.grant_id);
});
