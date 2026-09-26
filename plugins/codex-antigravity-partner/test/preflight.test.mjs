import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { observePreflight } from '../src/preflight.mjs';
import { buildReviewPacket } from '../src/review-packet.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fakeAgy = path.join(testDir, 'fixtures', 'fake-agy.mjs');

function makeWritable(target) {
  if (!fs.existsSync(target)) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) makeWritable(child);
    else if (!entry.isSymbolicLink()) fs.chmodSync(child, 0o600);
  }
  fs.chmodSync(target, 0o700);
}

test('preflight verifies a packet and its exact project configuration without granting approval', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-preflight-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    fs.mkdirSync(repositoryRoot);
    fs.writeFileSync(path.join(repositoryRoot, 'evidence.md'), 'public fixture evidence\n');
    const built = buildReviewPacket({
      version: 1,
      packet_id: 'preflight-packet',
      repository_root: repositoryRoot,
      source_root: repositoryRoot,
      files: ['evidence.md'],
      project: {
        project_id: 'preflight-test', sensitivity: 'normal', max_runtime_seconds: 10,
        allow_unattended_approval: true,
        allowed_models: ['gemini-test-pro'],
      },
    }, path.join(root, 'packets'));
    const result = observePreflight({
      configPath: path.join(built.packet_root, '.agent-collab', 'project.yaml'),
      model: 'gemini-test-pro',
      reviewManifestPath: built.manifest_path,
      agyCli: fakeAgy,
    });
    assert.deepEqual(result.packet, { integrity: 'valid', config_bound: true });
    assert.equal(result.config_allows_unattended_approval, true);
    assert.equal(result.permission_outcome, 'unverified');
  } finally {
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preflight reports unavailable MCP inventory as unknown rather than missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-ag-preflight-'));
  const previous = process.env.FAKE_AGY_MCP_LIST_FAIL;
  try {
    const configPath = path.join(root, 'project.yaml');
    fs.writeFileSync(configPath, `version: 1\nproject_id: preflight-test\nworkspace_root: .\nallowed_paths: [.]\nallowed_permissions: [sandbox]\nmax_runtime_seconds: 10\n`);
    process.env.FAKE_AGY_MCP_LIST_FAIL = '1';
    const result = observePreflight({
      configPath, model: 'gemini-test-pro', requiredMcpServers: ['home-developer'], agyCli: fakeAgy,
    });
    assert.equal(result.mcp_inventory, 'unavailable');
    assert.equal(result.mcp_servers['home-developer'], 'unknown');
  } finally {
    if (previous === undefined) delete process.env.FAKE_AGY_MCP_LIST_FAIL;
    else process.env.FAKE_AGY_MCP_LIST_FAIL = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
