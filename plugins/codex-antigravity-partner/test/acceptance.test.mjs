import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { cancelRun, cleanupOwnedRunsSync, startRun } from '../src/runner.mjs';
import { buildReviewPacket } from '../src/review-packet.mjs';
import { detectOrphans, readState, writeState } from '../src/state.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const agyCli = path.join(testDir, 'fixtures', 'fake-agy.mjs');
let root;
let stateDir;
let configPath;
let agyLog;

before(() => {
  fs.chmodSync(agyCli, 0o755);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-partner-'));
  stateDir = path.join(root, 'state');
  agyLog = path.join(root, 'agy-args.ndjson');
  process.env.FAKE_AGY_LOG = agyLog;
  const configDir = path.join(root, 'project', '.agent-collab');
  fs.mkdirSync(configDir, { recursive: true });
  configPath = path.join(configDir, 'project.yaml');
  fs.writeFileSync(configPath, `
version: 1
project_id: test-project
workspace_root: ..
allowed_paths:
  - ..
allowed_permissions:
  - sandbox
  - accept-edits
allow_unattended_approval: true
sensitivity: private
max_runtime_seconds: 10
allowed_models:
  - gemini-test-pro
`);
});

after(() => {
  delete process.env.FAKE_AGY_LOG;
  const makeWritable = (target) => {
    try {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) makeWritable(child);
        else if (!entry.isSymbolicLink()) fs.chmodSync(child, 0o600);
      }
      fs.chmodSync(target, 0o700);
    } catch { /* already absent */ }
  };
  makeWritable(root);
  fs.rmSync(root, { recursive: true, force: true });
});

const projectRoot = () => path.dirname(path.dirname(configPath));
const baseOptions = (prompt = 'Complete the bounded task.') => ({
  configPath,
  prompt,
  model: 'gemini-test-pro',
  modelRationale: 'Best available fixture model for this bounded test.',
  permission: 'sandbox',
  agyCli,
  stateDir,
});

async function waitForTerminal(runId, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readState(stateDir, runId);
    if (state && state.status !== 'queued' && state.status !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readState(stateDir, runId);
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runArgs() {
  return fs.readFileSync(agyLog, 'utf8').trim().split(/\r?\n/)
    .filter(Boolean).map((line) => JSON.parse(line)).filter((args) => args[0] !== 'models');
}

function reviewFixture() {
  const packetRoot = projectRoot();
  const sourcePath = path.join(packetRoot, 'review-file.md');
  fs.writeFileSync(sourcePath, 'review evidence\n');
  const configBytes = fs.readFileSync(configPath);
  const sourceBytes = fs.readFileSync(sourcePath);
  const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    manifest_version: 1,
    packet_id: 'acceptance-packet',
    files: [{ path: 'review-file.md', sha256: digest(sourceBytes), bytes: sourceBytes.length }],
    project_config: { path: '.agent-collab/project.yaml', sha256: digest(configBytes), bytes: configBytes.length },
  };
  const manifestPath = path.join(packetRoot, 'review-packet-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, sourcePath };
}

test('valid sandboxed run succeeds with the real CLI flag shape', async () => {
  const { run_id: runId } = startRun(baseOptions());
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'succeeded');
  assert.equal(state.result.status, 'completed');
  assert.equal(state.result.findings[0].classification, 'observed');
  assert.equal(Object.hasOwn(state.result, 'toolAction'), false);
  assert.equal(state.usage.total_tokens, 42);
  const args = runArgs().at(-1);
  assert.ok(args.includes('--sandbox'));
  assert.deepEqual(args.slice(0, 4), ['--mode', 'plan', '--model', 'gemini-test-pro']);
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('--json-schema'));
  assert.equal(args.some((argument) => argument.includes('dangerously-skip-permissions')), false);
});

test('new runs record bounded controller and CLI provenance', async () => {
  const { run_id: runId } = startRun(baseOptions());
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'succeeded');
  assert.equal(state.state_format_version, 2);
  assert.match(state.controller_version, /^0\.3\.2$/);
  assert.match(state.plugin_version, /^0\.3\.2\+codex\./);
  assert.equal(state.agy_cli_version, '1.0');
  assert.equal(JSON.stringify(state).includes('Complete the bounded task.'), false);
});

test('existing run records remain readable without inferred version data', () => {
  const runId = crypto.randomUUID();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, `${runId}.json`), JSON.stringify({ run_id: runId, status: 'succeeded' }));
  const state = readState(stateDir, runId);
  assert.equal(state.status, 'succeeded');
  assert.equal(Object.hasOwn(state, 'controller_version'), false);
  assert.equal(Object.hasOwn(state, 'agy_cli_version'), false);
});

test('malformed structured output reports its stage alongside a denied read', async () => {
  const { run_id: runId } = startRun(baseOptions('[denied-read-invalid]'));
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'permission_blocked');
  assert.equal(state.failure_stage, 'structured_output_parse');
  assert.equal(state.denied_action_class, 'read');
});

test('valid accept-edits run requires explicit permission and retains terminal sandboxing', async () => {
  const { run_id: runId } = startRun({ ...baseOptions(), permission: 'accept-edits' });
  assert.equal((await waitForTerminal(runId)).status, 'succeeded');
  const args = runArgs().at(-1);
  assert.deepEqual(args.slice(0, 2), ['--mode', 'accept-edits']);
  assert.equal(args.includes('--sandbox'), true);
});

test('explicit review mode binds the run to a verified packet and validates model source attestations', async () => {
  const { manifestPath } = reviewFixture();
  const { run_id: runId } = startRun({
    ...baseOptions('[valid-review]'), reviewMode: true, reviewManifestPath: manifestPath,
  });
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'succeeded');
  assert.equal(state.review.packet_id, 'acceptance-packet');
  assert.equal(state.attestation_validation.valid, true);
  assert.equal(state.attestation_validation.evidence_kind, 'validated_model_attestation');
  assert.equal(state.result.source_attestations[0].source, 'review-file.md');
});

test('a packet built by the public builder runs with only its hashed project configuration', async () => {
  const repositoryRoot = path.join(root, 'builder-repository');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), 'builder evidence\n');
  const built = buildReviewPacket({
    version: 1,
    packet_id: 'builder-integration-packet',
    repository_root: repositoryRoot,
    source_root: repositoryRoot,
    files: ['evidence.md'],
    project: {
      project_id: 'builder-integration', sensitivity: 'normal', max_runtime_seconds: 10,
      allow_unattended_approval: true,
      allowed_models: ['gemini-test-pro'],
    },
  }, path.join(root, 'built-packets'));
  const { run_id: runId } = startRun({
    ...baseOptions('[valid-review]'),
    configPath: path.join(built.packet_root, '.agent-collab', 'project.yaml'),
    workspaceRoot: built.packet_root,
    reviewMode: true,
    reviewManifestPath: built.manifest_path,
  });
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'succeeded');
  assert.equal(state.project_id, 'builder-integration');
  assert.deepEqual(state.effective_scope.additional_paths, []);
});

test('review mode fails closed for missing manifest binding, edit permission and missing attestations', async () => {
  const { manifestPath } = reviewFixture();
  assert.throws(() => startRun({ ...baseOptions(), reviewMode: true }), /manifest is required/i);
  assert.throws(() => startRun({ ...baseOptions(), reviewManifestPath: manifestPath }), /explicit review mode/i);
  assert.throws(() => startRun({
    ...baseOptions(), reviewMode: true, reviewManifestPath: manifestPath, permission: 'accept-edits',
  }), /review mode requires sandbox/i);
  assert.throws(() => startRun({
    ...baseOptions(), reviewMode: true, reviewManifestPath: manifestPath, additionalPaths: [projectRoot()],
  }), /does not allow additional paths/i);
  const alternateConfig = path.join(root, 'broad.yaml');
  fs.writeFileSync(alternateConfig, `
version: 1
project_id: broad
workspace_root: ${projectRoot()}
allowed_paths: [${root}]
allowed_permissions: [sandbox]
max_runtime_seconds: 10
allowed_models: [gemini-test-pro]
`);
  assert.throws(() => startRun({
    ...baseOptions(), configPath: alternateConfig, reviewMode: true, reviewManifestPath: manifestPath,
  }), /packet project configuration/i);
  const { run_id: runId } = startRun({
    ...baseOptions('[review-missing-attestation]'), reviewMode: true, reviewManifestPath: manifestPath,
  });
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'invalid_result');
  assert.match(state.error, /source attestation/i);
});

test('review mode rejects a packet changed after preflight', async () => {
  const { manifestPath, sourcePath } = reviewFixture();
  const { run_id: runId } = startRun({
    ...baseOptions('[review-sleep]'), reviewMode: true, reviewManifestPath: manifestPath,
  });
  fs.appendFileSync(sourcePath, 'mutation\n');
  const state = await waitForTerminal(runId);
  assert.equal(state.status, 'invalid_result');
  assert.match(state.error, /packet.*changed|integrity/i);
});

test('review mode rejects same-path config restored during model discovery after an unmanifested policy was loaded', () => {
  const repositoryRoot = path.join(root, 'raced-config-repository');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), 'raced config evidence\n');
  const built = buildReviewPacket({
    version: 1, packet_id: 'raced-config-packet', repository_root: repositoryRoot, source_root: repositoryRoot,
    files: ['evidence.md'],
    project: {
      project_id: 'manifest-policy', sensitivity: 'normal', max_runtime_seconds: 10,
      allow_unattended_approval: false, allowed_models: ['claude-test-thinking'],
    },
  }, path.join(root, 'raced-config-packets'));
  const packetConfig = path.join(built.packet_root, '.agent-collab', 'project.yaml');
  const safeCopy = path.join(root, 'manifest-config-copy.yaml');
  fs.copyFileSync(packetConfig, safeCopy);
  fs.chmodSync(built.packet_root, 0o700);
  fs.chmodSync(path.dirname(packetConfig), 0o700);
  fs.chmodSync(packetConfig, 0o600);
  fs.writeFileSync(packetConfig, `
version: 1
project_id: raced-config
workspace_root: ..
allowed_paths: [..]
allowed_permissions: [sandbox]
allow_unattended_approval: true
max_runtime_seconds: 10
allowed_models: [gemini-test-pro]
`);
  process.env.FAKE_AGY_RESTORE_CONFIG_SOURCE = safeCopy;
  process.env.FAKE_AGY_RESTORE_CONFIG_TARGET = packetConfig;
  try {
    assert.throws(() => startRun({
      ...baseOptions(), configPath: packetConfig, workspaceRoot: built.packet_root,
      model: 'gemini-test-pro', unattendedApproval: true,
      reviewMode: true, reviewManifestPath: built.manifest_path,
    }), /configuration does not match.*manifest hash/i);
  } finally {
    delete process.env.FAKE_AGY_RESTORE_CONFIG_SOURCE;
    delete process.env.FAKE_AGY_RESTORE_CONFIG_TARGET;
  }
});

test('unattended approval requires project and run opt-in and remains read-only', async () => {
  const notOptedInConfig = path.join(path.dirname(configPath), 'not-opted-in.yaml');
  fs.writeFileSync(notOptedInConfig, `
version: 1
project_id: not-opted-in-test
workspace_root: ..
allowed_paths: [..]
allowed_permissions: [sandbox, accept-edits]
allow_unattended_approval: false
max_runtime_seconds: 10
allowed_models: [gemini-test-pro]
`);
  assert.throws(
    () => startRun({ ...baseOptions(), configPath: notOptedInConfig, unattendedApproval: true }),
    /not allowed by the project configuration/,
  );
  const optedInConfig = path.join(path.dirname(configPath), 'unattended.yaml');
  fs.writeFileSync(optedInConfig, `
version: 1
project_id: unattended-test
workspace_root: ..
allowed_paths: [..]
allowed_permissions: [sandbox, accept-edits]
allow_unattended_approval: true
max_runtime_seconds: 10
allowed_models: [gemini-test-pro]
`);
  assert.throws(
    () => startRun({ ...baseOptions(), configPath: optedInConfig, permission: 'accept-edits', unattendedApproval: true }),
    /only for sandboxed plan runs/,
  );
  const { run_id: runId } = startRun({ ...baseOptions(), configPath: optedInConfig, unattendedApproval: true });
  assert.equal((await waitForTerminal(runId)).status, 'succeeded');
  const args = runArgs().at(-1);
  assert.equal(args.includes('--sandbox'), true);
  assert.equal(args.includes('--dangerously-skip-permissions'), true);
  assert.deepEqual(args.slice(0, 2), ['--mode', 'plan']);
});

test('model and rationale are mandatory and model is discovered live', () => {
  assert.throws(() => startRun({ ...baseOptions(), modelRationale: '  ' }), /Model rationale is required/);
  assert.throws(() => startRun({ ...baseOptions(), model: 'missing-model' }), /not currently available/);
});

test('configured model allow-list is enforced', () => {
  assert.throws(() => startRun({ ...baseOptions(), model: 'claude-test-thinking' }), /not allowed by the project/);
});

test('disallowed workspace and symlink escape are rejected before spawn', () => {
  assert.throws(() => startRun({ ...baseOptions(), workspaceRoot: os.tmpdir() }), /not within the configured allowed paths/);
  const link = path.join(projectRoot(), 'outside-link');
  fs.symlinkSync(os.tmpdir(), link);
  assert.throws(() => startRun({ ...baseOptions(), additionalPaths: [link] }), /not within the configured allowed paths/);
});

test('permission excluded by project configuration is rejected', () => {
  const sandboxOnly = path.join(path.dirname(configPath), 'sandbox-only.yaml');
  fs.writeFileSync(sandboxOnly, `
version: 1
project_id: sandbox-only
workspace_root: ..
allowed_paths: [..]
allowed_permissions: [sandbox]
max_runtime_seconds: 10
`);
  assert.throws(
    () => startRun({ ...baseOptions(), configPath: sandboxOnly, permission: 'accept-edits' }),
    /accept-edits permission is not allowed/,
  );
});

test('empty, narration-only and malformed structured output are invalid_result', async () => {
  for (const prompt of ['[empty]', '[narration]', '[malformed-result]']) {
    const { run_id: runId } = startRun(baseOptions(prompt));
    assert.equal((await waitForTerminal(runId)).status, 'invalid_result');
  }
});

test('agent error and non-zero exit are failed without persisting stderr', async () => {
  for (const prompt of ['[agent-error]', '[fail]']) {
    const { run_id: runId } = startRun(baseOptions(prompt));
    const state = await waitForTerminal(runId);
    assert.equal(state.status, 'failed');
    assert.equal(JSON.stringify(state).includes('simulated failure'), false);
  }
});

test('usage metadata is reduced to bounded non-negative token counters', async () => {
  const { run_id: runId } = startRun(baseOptions('[usage-noise]'));
  const state = await waitForTerminal(runId);
  assert.deepEqual(state.usage, { input_tokens: 10, total_tokens: 42 });
  assert.equal(JSON.stringify(state).includes('PROMPT-IN-USAGE'), false);
});

test('deadline reaches timed_out and cancellation reaches cancelled', async () => {
  const timed = startRun({ ...baseOptions('[sleep]'), runtimeMsOverride: 100 });
  assert.equal((await waitForTerminal(timed.run_id)).status, 'timed_out');
  const cancelled = startRun({ ...baseOptions('[sleep]'), runtimeMsOverride: 2_000 });
  assert.equal(cancelRun(cancelled.run_id, stateDir).status, 'cancelled');
  assert.equal((await waitForTerminal(cancelled.run_id)).status, 'cancelled');
});

test('cancellation escalates to descendants after the process leader exits', async () => {
  if (process.platform === 'win32') return;
  const pidFile = path.join(root, 'term-resistant-descendant.pid');
  process.env.FAKE_AGY_DESCENDANT_PID_FILE = pidFile;
  let descendantPid;
  try {
    const run = startRun({
      ...baseOptions('[leader-exits-child-ignores-term]'),
      runtimeMsOverride: 10_000,
    });
    assert.equal(await waitUntil(() => fs.existsSync(pidFile)), true);
    descendantPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.equal(isProcessAlive(descendantPid), true);

    assert.equal(cancelRun(run.run_id, stateDir).status, 'cancelled');
    assert.equal(await waitUntil(() => !isProcessAlive(descendantPid), 5_000), true);
  } finally {
    delete process.env.FAKE_AGY_DESCENDANT_PID_FILE;
    if (descendantPid && isProcessAlive(descendantPid)) {
      try { process.kill(descendantPid, 'SIGKILL'); } catch { /* already stopped */ }
    }
  }
});

test('transport cleanup kills a resistant descendant during the cancellation grace period', async () => {
  if (process.platform === 'win32') return;
  const pidFile = path.join(root, 'cleanup-resistant-descendant.pid');
  process.env.FAKE_AGY_DESCENDANT_PID_FILE = pidFile;
  let descendantPid;
  try {
    const run = startRun({
      ...baseOptions('[leader-exits-child-ignores-term]'),
      runtimeMsOverride: 10_000,
    });
    assert.equal(await waitUntil(() => fs.existsSync(pidFile)), true);
    descendantPid = Number(fs.readFileSync(pidFile, 'utf8'));
    const leaderPid = readState(stateDir, run.run_id).pid;

    assert.equal(cancelRun(run.run_id, stateDir).status, 'cancelled');
    assert.equal(await waitUntil(() => !isProcessAlive(leaderPid), 1_000), true);
    assert.equal(isProcessAlive(descendantPid), true);

    const cleaned = cleanupOwnedRunsSync(stateDir, 'Transport closed during cancellation grace period.');
    assert.equal(cleaned.some(({ run_id: runId }) => runId === run.run_id), true);
    assert.equal(await waitUntil(() => !isProcessAlive(descendantPid), 1_000), true);
  } finally {
    delete process.env.FAKE_AGY_DESCENDANT_PID_FILE;
    if (descendantPid && isProcessAlive(descendantPid)) {
      try { process.kill(descendantPid, 'SIGKILL'); } catch { /* already stopped */ }
    }
  }
});

test('state is atomic, owner-only and contains no prompt', async () => {
  const secretMarker = 'PROMPT-MUST-NOT-PERSIST';
  const { run_id: runId } = startRun(baseOptions(secretMarker));
  await waitForTerminal(runId);
  const stateFile = path.join(stateDir, `${runId}.json`);
  assert.equal(fs.statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(stateFile, 'utf8').includes(secretMarker), false);
  assert.deepEqual(fs.readdirSync(stateDir).filter((name) => name.endsWith('.tmp')), []);
});

test('heartbeat persistence does not look like semantic progress', async () => {
  const runId = 'heartbeat-state';
  const initial = writeState(stateDir, runId, { status: 'running', last_heartbeat: 'first' });
  const heartbeat = writeState(
    stateDir,
    runId,
    { ...initial, last_heartbeat: 'second' },
    { heartbeatOnly: true },
  );
  assert.equal(heartbeat.last_heartbeat, 'second');
  assert.equal(heartbeat.updated_at, initial.updated_at);
  assert.equal(heartbeat.revision, initial.revision);
});

test('persisted running state owned by another server becomes orphaned', () => {
  fs.mkdirSync(stateDir, { recursive: true });
  const runId = 'old-owner-run';
  fs.writeFileSync(path.join(stateDir, `${runId}.json`), JSON.stringify({
    run_id: runId,
    status: 'running',
    owner_id: 'old-server-owner',
    controller_pid: 99999999,
    started_at: new Date().toISOString(),
  }), { mode: 0o600 });
  const changed = detectOrphans(stateDir);
  assert.equal(changed.some((state) => state.run_id === runId), true);
  assert.equal(readState(stateDir, runId).status, 'orphaned');
});

test('a live foreign controller is not orphaned or falsely cancelled', () => {
  const runId = 'live-foreign-owner';
  fs.writeFileSync(path.join(stateDir, `${runId}.json`), JSON.stringify({
    run_id: runId,
    status: 'running',
    owner_id: 'another-live-server',
    controller_pid: process.pid,
    started_at: new Date().toISOString(),
  }), { mode: 0o600 });
  detectOrphans(stateDir);
  assert.equal(readState(stateDir, runId).status, 'running');
  assert.throws(() => cancelRun(runId, stateDir), /owned by another live controller/);
});

test('run IDs cannot escape the state directory', () => {
  assert.throws(() => readState(stateDir, '../../outside'), /Invalid run ID/);
});
