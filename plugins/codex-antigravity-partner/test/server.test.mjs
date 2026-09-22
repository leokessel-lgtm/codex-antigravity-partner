import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildReviewPacket } from '../src/review-packet.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(testDir);
const fakeAgy = path.join(testDir, 'fixtures', 'fake-agy.mjs');

function contentJson(result) {
  return JSON.parse(result.content[0].text);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitUntil(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

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

test('MCP exposes all tools and completes a bounded run through the public interface', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-'));
  const projectRoot = path.join(root, 'project');
  const configDir = path.join(projectRoot, '.agent-collab');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'project.yaml');
  fs.writeFileSync(configPath, `
version: 1
project_id: mcp-test
workspace_root: ..
allowed_paths: [..]
allowed_permissions: [sandbox]
max_runtime_seconds: 10
allowed_models: [gemini-test-pro]
`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: {
      ...process.env,
      AGY_BIN: fakeAgy,
      ANTIGRAVITY_PARTNER_STATE_DIR: stateDir,
    },
  });
  const client = new Client({ name: 'partner-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listedTools = (await client.listTools()).tools;
    const names = listedTools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['cancel_run', 'capabilities', 'create_adjudication', 'create_unattended_grant', 'get_run', 'list_runs', 'start_run', 'wait_run']);
    const startTool = listedTools.find((tool) => tool.name === 'start_run');
    assert.equal(startTool.inputSchema.properties.review_mode.type, 'boolean');
    assert.equal(startTool.inputSchema.properties.review_packet_manifest.type, 'string');
    assert.equal(startTool.inputSchema.properties.unattended_grant_id.type, 'string');
    const grantTool = listedTools.find((tool) => tool.name === 'create_unattended_grant');
    assert.deepEqual(grantTool.inputSchema.required, ['config_path', 'review_packet_manifest', 'model']);
    const adjudicationTool = listedTools.find((tool) => tool.name === 'create_adjudication');
    assert.deepEqual(adjudicationTool.inputSchema.required, ['run_id']);
    const capabilities = contentJson(await client.callTool({ name: 'capabilities', arguments: {} }));
    assert.deepEqual(capabilities.available_models, ['gemini-test-pro', 'claude-test-thinking']);
    assert.equal(capabilities.features.includes('review-packets'), true);
    assert.equal(capabilities.features.includes('validated-model-source-attestations'), true);
    assert.equal(capabilities.features.includes('codex-adjudication-artifacts'), true);
    assert.equal(capabilities.features.includes('permission-blocked-terminal-state'), true);
    assert.equal(capabilities.features.includes('identical-retry-suppression'), true);
    assert.equal(capabilities.features.includes('ephemeral-unattended-grants'), true);

    const started = contentJson(await client.callTool({
      name: 'start_run',
      arguments: {
        config_path: configPath,
        prompt: 'Complete the MCP integration test.',
        model: 'gemini-test-pro',
        model_rationale: 'Fixture model selected for the MCP integration test.',
        permission: 'sandbox',
      },
    }));
    assert.equal(started.status, 'running');
    const final = contentJson(await client.callTool({
      name: 'wait_run',
      arguments: { run_id: started.run_id, timeout_seconds: 3 },
    }));
    assert.equal(final.status, 'succeeded');

    const listed = contentJson(await client.callTool({ name: 'list_runs', arguments: { limit: 5 } }));
    assert.equal(listed.some((state) => state.run_id === started.run_id), true);
    assert.equal(Object.hasOwn(listed.find((state) => state.run_id === started.run_id), 'result'), false);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP creates and consumes a single-use packet-bound unattended grant', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-grant-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), 'grant evidence\n');
  const built = buildReviewPacket({
    version: 1,
    packet_id: 'mcp-grant-packet',
    repository_root: repositoryRoot,
    source_root: repositoryRoot,
    files: ['evidence.md'],
    project: {
      project_id: 'mcp-grant-test',
      sensitivity: 'normal',
      max_runtime_seconds: 10,
      allow_unattended_approval: true,
      allowed_models: ['gemini-test-pro'],
    },
  }, path.join(root, 'packets'));
  const configPath = path.join(built.packet_root, '.agent-collab', 'project.yaml');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-grant-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const created = contentJson(await client.callTool({
      name: 'create_unattended_grant',
      arguments: {
        config_path: configPath,
        review_packet_manifest: built.manifest_path,
        model: 'gemini-test-pro',
        expires_in_seconds: 300,
      },
    }));
    assert.equal(created.grant.manifest_sha256, built.manifest_sha256);
    assert.equal(created.grant.model, 'gemini-test-pro');
    assert.equal(fs.statSync(created.grant_path).mode & 0o777, 0o600);

    const started = contentJson(await client.callTool({
      name: 'start_run',
      arguments: {
        config_path: configPath,
        prompt: 'Complete the grant integration review.',
        model: 'gemini-test-pro',
        model_rationale: 'Fixture model for the packet-bound grant integration test.',
        permission: 'sandbox',
        unattended_approval: true,
        unattended_grant_id: created.grant.grant_id,
        review_mode: true,
        review_packet_manifest: built.manifest_path,
      },
    }));
    const final = contentJson(await client.callTool({
      name: 'wait_run', arguments: { run_id: started.run_id, timeout_seconds: 3 },
    }));
    assert.equal(final.status, 'succeeded');
    assert.equal(final.unattended_grant_id, created.grant.grant_id);

    const reused = await client.callTool({
      name: 'start_run',
      arguments: {
        config_path: configPath,
        prompt: 'Attempt to reuse the grant.',
        model: 'gemini-test-pro',
        model_rationale: 'Fixture model for a grant-reuse rejection test.',
        permission: 'sandbox',
        unattended_approval: true,
        unattended_grant_id: created.grant.grant_id,
        review_mode: true,
        review_packet_manifest: built.manifest_path,
      },
    });
    assert.equal(reused.isError, true);
    assert.match(contentJson(reused).error, /consumed|not available/i);
  } finally {
    await client.close();
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('wait_run advertises a client-safe interval below the common 60 second timeout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-wait-'));
  const stateDir = path.join(root, 'state');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-wait-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const waitTool = listed.tools.find((tool) => tool.name === 'wait_run');
    assert.ok(waitTool);
    assert.equal(waitTool.inputSchema.properties.timeout_seconds.maximum, 45);
    assert.equal(waitTool.inputSchema.properties.timeout_seconds.default, 30);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP completes a validated review and creates a bound unresolved adjudication artefact', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-review-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), 'review evidence\n');
  const built = buildReviewPacket({
    version: 1,
    packet_id: 'mcp-review-packet',
    repository_root: repositoryRoot,
    source_root: repositoryRoot,
    files: ['evidence.md'],
    project: {
      project_id: 'mcp-review-test',
      sensitivity: 'normal',
      max_runtime_seconds: 10,
      allow_unattended_approval: true,
      allowed_models: ['gemini-test-pro'],
    },
  }, path.join(root, 'packets'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-review-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const started = contentJson(await client.callTool({
      name: 'start_run',
      arguments: {
        config_path: path.join(built.packet_root, '.agent-collab', 'project.yaml'),
        prompt: 'Complete the MCP review and adjudication test.',
        model: 'gemini-test-pro',
        model_rationale: 'Fixture model selected for the public MCP review and adjudication test.',
        permission: 'sandbox',
        review_mode: true,
        review_packet_manifest: built.manifest_path,
      },
    }));
    const final = contentJson(await client.callTool({
      name: 'wait_run',
      arguments: { run_id: started.run_id, timeout_seconds: 3 },
    }));
    assert.equal(final.status, 'succeeded');
    assert.equal(final.attestation_validation.valid, true);
    assert.equal(final.attestation_validation.evidence_kind, 'validated_model_attestation');

    const response = await client.callTool({
      name: 'create_adjudication', arguments: { run_id: started.run_id },
    });
    assert.equal(response.isError, undefined);
    const created = contentJson(response);
    assert.equal(created.artifact.run_id, started.run_id);
    assert.equal(created.artifact.packet_id, 'mcp-review-packet');
    assert.equal(created.artifact.bindings.packet_manifest_sha256, built.manifest_sha256);
    assert.equal(created.artifact.status, 'pending_codex_review');
    assert.equal(created.artifact.delegated_findings.length, 1);
    assert.equal(created.artifact.delegated_findings[0].codex_decision, 'unresolved');
    assert.equal(created.artifact_path, path.join(stateDir, 'adjudications', `${started.run_id}.json`));
    assert.equal(fs.statSync(created.artifact_path).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(created.artifact_path, 'utf8')), created.artifact);
  } finally {
    await client.close();
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MCP rejects a review binding mismatch before creating the adjudications directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-review-binding-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(repositoryRoot);
  fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), 'review evidence\n');
  const built = buildReviewPacket({
    version: 1,
    packet_id: 'mcp-review-binding-packet',
    repository_root: repositoryRoot,
    source_root: repositoryRoot,
    files: ['evidence.md'],
    project: {
      project_id: 'mcp-review-binding-test',
      sensitivity: 'normal',
      max_runtime_seconds: 10,
      allow_unattended_approval: true,
      allowed_models: ['gemini-test-pro'],
    },
  }, path.join(root, 'packets'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-review-binding-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const started = contentJson(await client.callTool({
      name: 'start_run',
      arguments: {
        config_path: path.join(built.packet_root, '.agent-collab', 'project.yaml'),
        prompt: 'Complete the MCP review binding test.',
        model: 'gemini-test-pro',
        model_rationale: 'Fixture model selected for the public MCP review binding test.',
        permission: 'sandbox',
        review_mode: true,
        review_packet_manifest: built.manifest_path,
      },
    }));
    const final = contentJson(await client.callTool({
      name: 'wait_run', arguments: { run_id: started.run_id, timeout_seconds: 3 },
    }));
    assert.equal(final.status, 'succeeded');
    const statePath = path.join(stateDir, `${started.run_id}.json`);
    const mismatched = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    mismatched.review.manifest_sha256 = 'b'.repeat(64);
    fs.writeFileSync(statePath, `${JSON.stringify(mismatched, null, 2)}\n`, { mode: 0o600 });

    const response = await client.callTool({
      name: 'create_adjudication', arguments: { run_id: started.run_id },
    });
    assert.equal(response.isError, true);
    assert.match(contentJson(response).error, /manifest hashes do not match/i);
    assert.equal(fs.existsSync(path.join(stateDir, 'adjudications')), false);
  } finally {
    await client.close();
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('closing the MCP transport cancels the run and kills its detached process', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-disconnect-'));
  const projectRoot = path.join(root, 'project');
  const configDir = path.join(projectRoot, '.agent-collab');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'project.yaml');
  fs.writeFileSync(configPath, `
version: 1
project_id: mcp-disconnect-test
workspace_root: ..
allowed_paths: [..]
allowed_permissions: [sandbox]
max_runtime_seconds: 10
allowed_models: [gemini-test-pro]
`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-disconnect-test-client', version: '1.0.0' });
  let childPid;
  let runId;
  try {
    await client.connect(transport);
    const started = contentJson(await client.callTool({
      name: 'start_run',
      arguments: {
        config_path: configPath,
        prompt: '[sleep] Complete the MCP disconnect test.',
        model: 'gemini-test-pro',
        model_rationale: 'Fixture model for disconnect cleanup.',
        permission: 'sandbox',
      },
    }));
    runId = started.run_id;
    const stateFile = path.join(stateDir, `${runId}.json`);
    childPid = JSON.parse(fs.readFileSync(stateFile, 'utf8')).pid;
    assert.equal(isProcessAlive(childPid), true);

    await client.close();
    const terminalRecorded = await waitUntil(() => {
      try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).status === 'cancelled'; } catch { return false; }
    });
    assert.equal(terminalRecorded, true);
    const finalState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(finalState.error, 'Cancelled because the MCP controller stopped or its transport disconnected.');
    assert.equal(typeof finalState.owner_id, 'string');
    assert.equal(Number.isInteger(finalState.controller_pid), true);
    assert.equal(await waitUntil(() => !isProcessAlive(childPid)), true);
  } finally {
    try { await client.close(); } catch { /* already closed */ }
    if (isProcessAlive(childPid)) {
      try { process.kill(process.platform === 'win32' ? childPid : -childPid, 'SIGKILL'); } catch { /* already stopped */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create_adjudication rejects a run ID mismatch in corrupt durable state without path escape', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-adjudication-'));
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateDir, 'safe-run.json'), JSON.stringify({
    run_id: '../../escaped', status: 'succeeded', review: {}, attestation_validation: { valid: true }, result: { findings: [] },
  }), { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-adjudication-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'create_adjudication', arguments: { run_id: 'safe-run' } });
    assert.equal(response.isError, true);
    assert.match(contentJson(response).error, /does not match/);
    assert.equal(fs.existsSync(path.join(root, 'escaped.json')), false);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create_adjudication rejects a successful non-review run before reading a manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-non-review-'));
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateDir, 'ordinary-run.json'), JSON.stringify({
    run_id: 'ordinary-run', status: 'succeeded', result: { status: 'completed' },
  }), { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-non-review-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'create_adjudication', arguments: { run_id: 'ordinary-run' } });
    assert.equal(response.isError, true);
    assert.match(contentJson(response).error, /successful validated review run/i);
    assert.equal(fs.existsSync(path.join(stateDir, 'adjudications')), false);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('create_adjudication rejects malformed review metadata before reading a manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-mcp-malformed-review-'));
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stateDir, 'malformed-review.json'), JSON.stringify({
    run_id: 'malformed-review', status: 'succeeded', review: {}, result: { status: 'completed' },
  }), { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server.mjs')],
    cwd: pluginRoot,
    env: { ...process.env, AGY_BIN: fakeAgy, ANTIGRAVITY_PARTNER_STATE_DIR: stateDir },
  });
  const client = new Client({ name: 'partner-malformed-review-test-client', version: '1.0.0' });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'create_adjudication', arguments: { run_id: 'malformed-review' } });
    assert.equal(response.isError, true);
    assert.match(contentJson(response).error, /successful validated review run/i);
    assert.equal(fs.existsSync(path.join(stateDir, 'adjudications')), false);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
