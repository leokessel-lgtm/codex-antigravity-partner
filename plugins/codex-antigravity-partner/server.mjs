import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildAdjudication, preflightAdjudication, reviewManifestPath } from './src/adjudication.mjs';
import { loadConfig } from './src/config.mjs';
import { canonicalJson, sha256 } from './src/integrity.mjs';
import { listModels, validateModel } from './src/models.mjs';
import { verifyReviewPacket } from './src/review-packet.mjs';
import { observePreflight } from './src/preflight.mjs';
import { cancelRun, cleanupOwnedRunsSync, startRun } from './src/runner.mjs';
import { detectOrphans, listStates, readState, TERMINAL_STATES } from './src/state.mjs';
import { createUnattendedGrant } from './src/unattended-grant.mjs';
import { CONTROLLER_VERSION } from './src/version.mjs';

const agyCli = process.env.AGY_BIN || 'agy';
const stateDir = process.env.ANTIGRAVITY_PARTNER_STATE_DIR
  || path.join(os.homedir(), '.codex', 'antigravity-partner', 'runs');
detectOrphans(stateDir);

const textResult = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const tools = [
  {
    name: 'capabilities',
    description: 'Report the live Antigravity models and the local controller capabilities.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'start_run',
    description: 'Start one bounded asynchronous Antigravity headless run. Starting is not completion. An unattended review also requires a fresh single-use packet-bound grant.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['config_path', 'prompt', 'model', 'model_rationale'],
      properties: {
        config_path: { type: 'string', minLength: 1 },
        prompt: { type: 'string', minLength: 1, maxLength: 50000 },
        model: { type: 'string', minLength: 1 },
        model_rationale: { type: 'string', minLength: 1, maxLength: 2000 },
        permission: { type: 'string', enum: ['sandbox', 'accept-edits'], default: 'sandbox' },
        unattended_approval: { type: 'boolean', default: false },
        unattended_grant_id: { type: 'string', minLength: 1, maxLength: 100 },
        workspace_root: { type: 'string', minLength: 1 },
        additional_paths: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1 } },
        review_mode: { type: 'boolean', default: false },
        review_packet_manifest: { type: 'string', minLength: 1 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'preflight',
    description: 'Observe local AG model and MCP configuration without starting a run or predicting permission or authentication outcomes.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['config_path', 'model'],
      properties: {
        config_path: { type: 'string', minLength: 1 },
        model: { type: 'string', minLength: 1 },
        required_mcp_servers: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } },
        review_packet_manifest: { type: 'string', minLength: 1 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'create_unattended_grant',
    description: 'Create a single-use, time-limited unattended review grant bound to an exact packet manifest, model and sandbox permission. Call only after explicit user approval for that concrete review.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['config_path', 'review_packet_manifest', 'model'],
      properties: {
        config_path: { type: 'string', minLength: 1 },
        review_packet_manifest: { type: 'string', minLength: 1 },
        model: { type: 'string', minLength: 1 },
        expires_in_seconds: { type: 'integer', minimum: 30, maximum: 1800, default: 600 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'get_run',
    description: 'Read the current durable state of one Antigravity run.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['run_id'],
      properties: { run_id: { type: 'string', minLength: 1, maxLength: 100 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'wait_run',
    description: 'Wait up to 45 seconds for a semantic run update or terminal state.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['run_id'],
      properties: {
        run_id: { type: 'string', minLength: 1, maxLength: 100 },
        after_updated_at: { type: 'string' },
        timeout_seconds: { type: 'integer', minimum: 1, maximum: 45, default: 30 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'cancel_run',
    description: 'Cancel one non-terminal run owned by this local controller.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['run_id'],
      properties: { run_id: { type: 'string', minLength: 1, maxLength: 100 } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'list_runs',
    description: 'List recent run summaries without prompts or full delegated results.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'create_adjudication',
    description: 'Create a separate unresolved Codex adjudication artefact for one successful validated review.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['run_id'],
      properties: { run_id: { type: 'string', minLength: 1, maxLength: 100 } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

function requireRun(runId) {
  const state = readState(stateDir, runId);
  if (!state) throw new Error('Run not found.');
  return state;
}

async function waitForRun(runId, afterUpdatedAt, timeoutSeconds = 30) {
  const effectiveTimeout = Math.min(Math.max(1, timeoutSeconds), 45);
  const deadline = Date.now() + effectiveTimeout * 1000;
  let state = requireRun(runId);
  const baseline = afterUpdatedAt || state.updated_at;
  while (Date.now() < deadline) {
    if (TERMINAL_STATES.has(state.status) || state.updated_at !== baseline) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = requireRun(runId);
  }
  return { ...state, wait_timed_out: true };
}

const server = new Server(
  { name: 'codex-antigravity-partner', version: CONTROLLER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {};
  try {
    switch (request.params.name) {
      case 'capabilities':
        return textResult({
          agy_executable: agyCli,
          available_models: listModels(agyCli),
          permissions: ['sandbox', 'accept-edits'],
          features: ['structured-results', 'durable-state', 'heartbeat', 'timeout', 'cancel', 'orphan-detection', 'two-key-unattended-approval', 'client-safe-wait', 'disconnect-cleanup', 'review-packets', 'validated-model-source-attestations', 'codex-adjudication-artifacts', 'permission-blocked-terminal-state', 'identical-retry-suppression', 'ephemeral-unattended-grants', 'observational-preflight'],
          limitations: ['no-cross-process-reattach', 'no-semantic-progress', 'no-desktop-task-creation'],
        });
      case 'start_run':
        return textResult(startRun({
          configPath: args.config_path,
          prompt: args.prompt,
          model: args.model,
          modelRationale: args.model_rationale,
          permission: args.permission || 'sandbox',
          unattendedApproval: args.unattended_approval || false,
          unattendedGrantId: args.unattended_grant_id,
          workspaceRoot: args.workspace_root,
          additionalPaths: args.additional_paths || [],
          reviewMode: args.review_mode || false,
          reviewManifestPath: args.review_packet_manifest,
          agyCli,
          stateDir,
        }));
      case 'preflight':
        return textResult(observePreflight({
          configPath: args.config_path,
          model: args.model,
          requiredMcpServers: args.required_mcp_servers || [],
          reviewManifestPath: args.review_packet_manifest,
          agyCli,
        }));
      case 'create_unattended_grant': {
        const packet = verifyReviewPacket(args.review_packet_manifest);
        if (!packet.valid) {
          throw new Error(`Review packet failed preflight integrity: ${packet.failures.map((failure) => failure.path).join(', ')}`);
        }
        const config = loadConfig(args.config_path);
        const packetConfigPath = path.join(packet.packet_root, packet.manifest.project_config?.path || '');
        if (config.config_path !== packetConfigPath || config.config_sha256 !== packet.manifest.project_config?.sha256) {
          throw new Error('Unattended grant requires the packet project configuration bound by the manifest.');
        }
        if (config.workspace_root !== packet.packet_root
          || config.allowed_paths.length !== 1
          || config.allowed_paths[0] !== packet.packet_root) {
          throw new Error('Unattended grant configuration may not widen the packet workspace.');
        }
        if (!config.allowed_permissions.includes('sandbox')) {
          throw new Error('Sandbox permission is not allowed by the project configuration.');
        }
        if (!config.allow_unattended_approval) {
          throw new Error('Unattended approval is not allowed by the project configuration. Rebuild an eligible non-sensitive packet with allow_unattended_approval: true, then obtain fresh explicit approval for the new manifest before creating a grant. Approval for the old manifest does not transfer.');
        }
        validateModel(args.model, agyCli, config.allowed_models || []);
        return textResult(createUnattendedGrant({
          stateDir,
          manifestSha256: packet.manifest_sha256,
          model: args.model,
          permission: 'sandbox',
          ttlSeconds: args.expires_in_seconds ?? 600,
        }));
      }
      case 'get_run':
        return textResult(requireRun(args.run_id));
      case 'wait_run':
        return textResult(await waitForRun(args.run_id, args.after_updated_at, args.timeout_seconds ?? 30));
      case 'cancel_run':
        return textResult(cancelRun(args.run_id, stateDir));
      case 'list_runs':
        return textResult(listStates(stateDir, args.limit || 20).map(({ result, usage, ...summary }) => summary));
      case 'create_adjudication': {
        const state = requireRun(args.run_id);
        if (state.run_id !== args.run_id) throw new Error('Stored run ID does not match the requested run ID.');
        const packet = verifyReviewPacket(reviewManifestPath(state));
        preflightAdjudication(state, packet);
        const artifactDir = path.join(stateDir, 'adjudications');
        fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
        fs.chmodSync(artifactDir, 0o700);
        const artifactPath = path.join(artifactDir, `${args.run_id}.json`);
        const artifact = buildAdjudication(state, packet, artifactPath);
        return textResult({
          artifact_path: artifactPath,
          artifact_sha256: sha256(canonicalJson(artifact)),
          artifact,
        });
      }
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return textResult({ error: error.message }, true);
  }
});

let isShuttingDown = false;
const CONTROLLER_SHUTDOWN_REASON = 'Cancelled because the MCP controller stopped or its transport disconnected.';
function shutdown(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanupOwnedRunsSync(stateDir, reason);
}

server.onclose = () => shutdown(CONTROLLER_SHUTDOWN_REASON);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown(CONTROLLER_SHUTDOWN_REASON);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

await server.connect(new StdioServerTransport());
