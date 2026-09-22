import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { validateModel } from './models.mjs';
import { assertAllowed, canonicalize } from './paths.mjs';
import { readReviewPacket, verifyReviewPacket } from './review-packet.mjs';
import { validateReviewResult } from './review-validation.mjs';
import { listStates, readState, SERVER_OWNER_ID, TERMINAL_STATES, writeState } from './state.mjs';
import { consumeUnattendedGrant } from './unattended-grant.mjs';
import { validateResult } from './validate.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const resultSchemaPath = path.join(moduleDir, '..', 'schemas', 'delegated-result.schema.json');
const RUNNING_PROCESSES = new Map();
const MAX_OUTPUT_BYTES = 512 * 1024;
const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens', 'total_tokens'];
const READ_PERMISSION_REQUIRED_CHANGE = 'Change authority by supplying a fresh packet-bound unattended grant, or change the review packet or scope. Do not retry the same run configuration.';

function deniedActionClass(deniedActions) {
  if (!Array.isArray(deniedActions)) return null;
  const readDenied = deniedActions.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const action = typeof item.action === 'string' ? item.action.toLowerCase() : '';
    const display = typeof item.display_name === 'string'
      ? item.display_name.toLowerCase().replace(/[^a-z]/g, '')
      : '';
    return action === 'read_file' || display === 'viewfile' || display === 'listdir';
  });
  return readDenied ? 'read' : null;
}

function permissionBlockedPatch(deniedActions) {
  if (deniedActionClass(deniedActions) !== 'read') return null;
  return {
    status: 'permission_blocked',
    error: 'Antigravity read access was denied under the current approval state.',
    reason_code: 'read_permission_denied',
    denied_action_class: 'read',
    retryable: false,
    required_change: READ_PERMISSION_REQUIRED_CHANGE,
    denied_actions: deniedActions,
  };
}

function findBlockingPrior(stateDir, review, permission, unattendedApproval, unattendedGrantId) {
  if (!review) return null;
  return listStates(stateDir, 500).find((state) => (
    state.status === 'permission_blocked'
    && state.reason_code === 'read_permission_denied'
    && state.denied_action_class === 'read'
    && state.review?.manifest_sha256 === review.manifest_sha256
    && state.permission === permission
    && state.unattended_approval === unattendedApproval
    && state.unattended_grant_id === unattendedGrantId
  )) || null;
}

function normaliseUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = {};
  for (const field of USAGE_FIELDS) {
    const count = value[field];
    if (Number.isSafeInteger(count) && count >= 0) usage[field] = count;
  }
  return Object.keys(usage).length ? usage : undefined;
}

function appendBounded(current, chunk) {
  if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return { text: current, truncated: true };
  const combined = current + chunk.toString('utf8');
  if (Buffer.byteLength(combined) <= MAX_OUTPUT_BYTES) return { text: combined, truncated: false };
  return { text: Buffer.from(combined).subarray(0, MAX_OUTPUT_BYTES).toString('utf8'), truncated: true };
}

function signalProcessTree(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function parseDelegatedOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    return { kind: 'invalid', error: 'Antigravity did not return a valid JSON envelope.' };
  }
  if (envelope?.status !== 'SUCCESS') {
    return {
      kind: 'failed',
      error: typeof envelope?.error === 'string' && envelope.error.trim()
        ? envelope.error.slice(0, 2000)
        : `Antigravity reported ${envelope?.status || 'an unknown status'}.`,
      denied_actions: Array.isArray(envelope?.denied_actions) ? envelope.denied_actions : [],
    };
  }

  let result = envelope.structured_output ?? envelope.response;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch {
      return {
        kind: 'invalid',
        error: 'Antigravity reported success without a structured final result.',
        denied_actions: Array.isArray(envelope.denied_actions) ? envelope.denied_actions : [],
      };
    }
  }
  const validation = validateResult(result);
  if (!validation.valid || !result.summary.trim()) {
    return {
      kind: 'invalid',
      error: `Delegated result failed validation${validation.errors.length ? `: ${validation.errors.join('; ')}` : '.'}`,
      denied_actions: Array.isArray(envelope.denied_actions) ? envelope.denied_actions : [],
    };
  }
  return {
    kind: 'valid',
    result,
    conversation_id: typeof envelope.conversation_id === 'string' ? envelope.conversation_id : undefined,
    usage: normaliseUsage(envelope.usage),
    denied_actions: Array.isArray(envelope.denied_actions) ? envelope.denied_actions : [],
  };
}

function stopTimers(control, { preserveForceKill = false } = {}) {
  clearInterval(control?.heartbeat);
  clearTimeout(control?.deadline);
  if (!preserveForceKill) clearTimeout(control?.forceKill);
}

function terminalUpdate(stateDir, runId, patch) {
  const current = readState(stateDir, runId);
  if (!current || TERMINAL_STATES.has(current.status)) return current;
  return writeState(stateDir, runId, {
    ...current,
    ...patch,
    ended_at: new Date().toISOString(),
  });
}

export function startRun(options) {
  const {
    configPath,
    prompt,
    model,
    modelRationale,
    permission = 'sandbox',
    unattendedApproval = false,
    unattendedGrantId,
    workspaceRoot,
    additionalPaths = [],
    reviewMode = false,
    reviewManifestPath,
    agyCli = 'agy',
    stateDir,
    runtimeMsOverride,
  } = options;

  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required.');
  if (prompt.length > 50_000) throw new Error('Prompt exceeds the 50,000 character limit.');
  if (typeof model !== 'string' || !model.trim()) throw new Error('Model is required.');
  if (typeof modelRationale !== 'string' || !modelRationale.trim()) throw new Error('Model rationale is required.');
  if (modelRationale.length > 2_000) throw new Error('Model rationale exceeds the 2,000 character limit.');
  if (!['sandbox', 'accept-edits'].includes(permission)) throw new Error('Permission must be sandbox or accept-edits.');
  if (!stateDir) throw new Error('State directory is required.');
  if (reviewMode && !reviewManifestPath) throw new Error('A review packet manifest is required in explicit review mode.');
  if (!reviewMode && reviewManifestPath) throw new Error('A review packet manifest requires explicit review mode.');
  if (reviewMode && permission !== 'sandbox') throw new Error('Review mode requires sandbox permission.');
  if (reviewMode && additionalPaths.length > 0) throw new Error('Review mode does not allow additional paths.');

  const config = loadConfig(configPath);
  if (!config.allowed_permissions.includes(permission)) {
    throw new Error(`${permission} permission is not allowed by the project configuration.`);
  }
  if (unattendedApproval && !config.allow_unattended_approval) {
    throw new Error('Unattended approval is not allowed by the project configuration.');
  }
  if (unattendedApproval && permission !== 'sandbox') {
    throw new Error('Unattended approval is permitted only for sandboxed plan runs.');
  }
  if (unattendedGrantId && (!reviewMode || !unattendedApproval)) {
    throw new Error('An unattended grant may be used only for an unattended review run.');
  }
  validateModel(model, agyCli, config.allowed_models || []);

  const effectiveWorkspace = workspaceRoot
    ? canonicalize(workspaceRoot, config.workspace_root)
    : config.workspace_root;
  assertAllowed(effectiveWorkspace, config.allowed_paths);
  const effectiveAdditional = additionalPaths.map((candidate) => {
    const resolved = canonicalize(candidate, config.workspace_root);
    assertAllowed(resolved, config.allowed_paths);
    return resolved;
  });

  let review;
  if (reviewMode) {
    const resolvedManifest = canonicalize(reviewManifestPath, effectiveWorkspace);
    assertAllowed(resolvedManifest, config.allowed_paths);
    const loaded = readReviewPacket(resolvedManifest);
    if (loaded.packet_root !== effectiveWorkspace) {
      throw new Error('Review packet manifest must be at the review workspace root.');
    }
    const packetConfigPath = path.join(loaded.packet_root, loaded.manifest.project_config?.path || '');
    if (config.config_path !== packetConfigPath) {
      throw new Error('Review mode must use the packet project configuration bound by the manifest.');
    }
    if (config.config_sha256 !== loaded.manifest.project_config.sha256) {
      throw new Error('Loaded review project configuration does not match the packet manifest hash.');
    }
    if (config.workspace_root !== loaded.packet_root
      || config.allowed_paths.length !== 1
      || config.allowed_paths[0] !== loaded.packet_root) {
      throw new Error('Review packet project configuration may not widen the packet workspace.');
    }
    const verified = verifyReviewPacket(resolvedManifest);
    if (!verified.valid) throw new Error(`Review packet failed preflight integrity: ${verified.failures.map((failure) => failure.path).join(', ')}`);
    review = {
      packet_id: loaded.manifest.packet_id,
      manifest_path: loaded.manifest_path,
      manifest_sha256: loaded.manifest_sha256,
      manifest: loaded.manifest,
    };
  }

  if (review && !config.allow_unattended_approval) {
    throw new Error('Review packet is not eligible for the exact-manifest grant workflow. Rebuild a non-sensitive packet with allow_unattended_approval: true, then obtain fresh explicit approval for its new manifest before start_run. Approval for the old manifest does not transfer.');
  }

  const blockingPrior = findBlockingPrior(
    stateDir,
    review,
    permission,
    unattendedApproval,
    unattendedGrantId,
  );
  if (blockingPrior) {
    throw new Error(`Identical retry blocked after prior permission-blocked run ${blockingPrior.run_id}. ${blockingPrior.required_change || READ_PERMISSION_REQUIRED_CHANGE}`);
  }

  let consumedGrant;
  if (review && unattendedApproval) {
    if (!unattendedGrantId) throw new Error('A fresh packet-bound unattended grant is required for an unattended review run.');
    consumedGrant = consumeUnattendedGrant({
      stateDir,
      grantId: unattendedGrantId,
      manifestSha256: review.manifest_sha256,
      model,
      permission,
    });
  }

  const runId = crypto.randomUUID();
  writeState(stateDir, runId, {
    status: 'queued',
    created_at: new Date().toISOString(),
    project_id: config.project_id,
    model,
    model_rationale: modelRationale.trim(),
    permission,
    unattended_approval: unattendedApproval,
    ...(consumedGrant ? { unattended_grant_id: consumedGrant.grant_id } : {}),
    effective_scope: { workspace_root: effectiveWorkspace, additional_paths: effectiveAdditional },
    ...(review ? { review: { packet_id: review.packet_id, manifest_path: review.manifest_path, manifest_sha256: review.manifest_sha256 } } : {}),
  });

  const maxRuntimeMs = runtimeMsOverride ?? config.max_runtime_seconds * 1000;
  const args = [
    '--mode', permission === 'accept-edits' ? 'accept-edits' : 'plan',
    '--model', model,
    '--output-format', 'json',
    '--json-schema', resultSchemaPath,
    '--print-timeout', `${config.max_runtime_seconds}s`,
  ];
  args.push('--sandbox');
  if (unattendedApproval) args.push('--dangerously-skip-permissions');
  for (const allowed of effectiveAdditional) args.push('--add-dir', allowed);
  const effectivePrompt = review ? `${prompt}\n\n[CONTROLLER_REVIEW_PACKET]\n${JSON.stringify({
    packet_id: review.packet_id,
    manifest_sha256: review.manifest_sha256,
    sources: review.manifest.files.map(({ path: source, sha256: digest }) => ({ source, sha256: digest })),
    requirement: 'Return source_attestations for every packet source consulted. Every finding citation source must be attested. These are model claims validated against the manifest, not filesystem read telemetry.',
  })}\n[/CONTROLLER_REVIEW_PACKET]` : prompt;
  args.push(`--print=${effectivePrompt}`);

  const child = spawn(agyCli, args, {
    cwd: effectiveWorkspace,
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const running = writeState(stateDir, runId, {
    ...readState(stateDir, runId),
    status: 'running',
    started_at: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    pid: child.pid,
  });

  const control = { child, stdout: '', stderr: '', truncated: false };
  RUNNING_PROCESSES.set(runId, control);
  child.stdout.on('data', (chunk) => {
    const next = appendBounded(control.stdout, chunk);
    control.stdout = next.text;
    control.truncated ||= next.truncated;
  });
  child.stderr.on('data', (chunk) => {
    const next = appendBounded(control.stderr, chunk);
    control.stderr = next.text;
    control.truncated ||= next.truncated;
  });

  control.heartbeat = setInterval(() => {
    const current = readState(stateDir, runId);
    if (current?.status === 'running') {
      writeState(stateDir, runId, { ...current, last_heartbeat: new Date().toISOString() }, { heartbeatOnly: true });
    }
  }, 15_000);
  control.deadline = setTimeout(() => {
    const state = terminalUpdate(stateDir, runId, {
      status: 'timed_out',
      error: `Run exceeded ${config.max_runtime_seconds} seconds.`,
    });
    if (state?.status === 'timed_out') {
      signalProcessTree(child, 'SIGTERM');
      control.forceKill = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 3_000);
    }
  }, maxRuntimeMs);

  child.once('error', (error) => {
    stopTimers(control);
    RUNNING_PROCESSES.delete(runId);
    terminalUpdate(stateDir, runId, { status: 'failed', error: `Could not start Antigravity: ${error.message}` });
  });
  child.once('close', (code, signal) => {
    const current = readState(stateDir, runId);
    const preserveForceKill = Boolean(
      control.forceKill && (current?.status === 'cancelled' || current?.status === 'timed_out'),
    );
    stopTimers(control, { preserveForceKill });
    RUNNING_PROCESSES.delete(runId);
    if (!current || TERMINAL_STATES.has(current.status)) return;
    if (code !== 0) {
      terminalUpdate(stateDir, runId, {
        status: 'failed',
        error: `Antigravity exited with code ${code ?? 'none'}${signal ? ` after ${signal}` : ''}.`,
      });
      return;
    }
    if (control.truncated) {
      terminalUpdate(stateDir, runId, { status: 'invalid_result', error: 'Antigravity output exceeded the controller limit.' });
      return;
    }
    const parsed = parseDelegatedOutput(control.stdout);
    if (parsed.kind === 'failed') {
      terminalUpdate(
        stateDir,
        runId,
        permissionBlockedPatch(parsed.denied_actions)
          || { status: 'failed', error: parsed.error, denied_actions: parsed.denied_actions },
      );
    } else if (parsed.kind === 'invalid') {
      terminalUpdate(
        stateDir,
        runId,
        permissionBlockedPatch(parsed.denied_actions)
          || { status: 'invalid_result', error: parsed.error, denied_actions: parsed.denied_actions },
      );
    } else {
      if (review) {
        const packetAfter = verifyReviewPacket(review.manifest_path);
        if (!packetAfter.valid || packetAfter.manifest_sha256 !== review.manifest_sha256) {
          terminalUpdate(stateDir, runId, {
            status: 'invalid_result',
            error: 'Review packet integrity changed after preflight.',
            packet_verification: { valid: false, failures: packetAfter.failures },
          });
          return;
        }
        const attestationValidation = validateReviewResult(parsed.result, review.manifest);
        if (!attestationValidation.valid) {
          terminalUpdate(stateDir, runId, {
            status: 'invalid_result',
            error: `Review source attestation validation failed: ${attestationValidation.errors.join('; ')}`,
            attestation_validation: attestationValidation,
            denied_actions: parsed.denied_actions,
          });
          return;
        }
        terminalUpdate(stateDir, runId, {
          status: 'succeeded',
          result: parsed.result,
          conversation_id: parsed.conversation_id,
          usage: parsed.usage,
          denied_actions: parsed.denied_actions,
          attestation_validation: attestationValidation,
          packet_verification: { valid: true, checked_files: packetAfter.checks.length },
        });
        return;
      }
      terminalUpdate(stateDir, runId, {
        status: 'succeeded',
        result: parsed.result,
        conversation_id: parsed.conversation_id,
        usage: parsed.usage,
        denied_actions: parsed.denied_actions,
      });
    }
  });

  return { run_id: runId, status: running.status, effective_scope: running.effective_scope, model, permission };
}

export function cancelRun(runId, stateDir) {
  const current = readState(stateDir, runId);
  if (!current) throw new Error('Run not found.');
  if (TERMINAL_STATES.has(current.status)) return current;
  if (current.owner_id !== SERVER_OWNER_ID) {
    throw new Error('Run is owned by another live controller and cannot be cancelled from this task.');
  }
  const cancelled = terminalUpdate(stateDir, runId, { status: 'cancelled', error: 'Cancelled by Codex.' });
  const control = RUNNING_PROCESSES.get(runId);
  if (control) {
    stopTimers(control);
    signalProcessTree(control.child, 'SIGTERM');
    control.forceKill = setTimeout(() => signalProcessTree(control.child, 'SIGKILL'), 3_000);
  }
  return cancelled;
}

export function cleanupOwnedRunsSync(stateDir, reason = 'Cancelled because the MCP transport disconnected.') {
  const cleaned = [];
  for (const [runId, control] of RUNNING_PROCESSES.entries()) {
    stopTimers(control);
    let state;
    let error;
    try {
      state = terminalUpdate(stateDir, runId, { status: 'cancelled', error: reason });
    } catch (caught) {
      error = caught.message;
    }
    try {
      signalProcessTree(control.child, 'SIGKILL');
    } catch (caught) {
      error = error ? `${error}; ${caught.message}` : caught.message;
    } finally {
      RUNNING_PROCESSES.delete(runId);
    }
    cleaned.push({ run_id: runId, status: state?.status, ...(error ? { error } : {}) });
  }
  return cleaned;
}
