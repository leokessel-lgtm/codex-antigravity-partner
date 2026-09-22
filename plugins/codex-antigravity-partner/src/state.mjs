import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SERVER_OWNER_ID = crypto.randomUUID();
export const TERMINAL_STATES = new Set([
  'succeeded', 'failed', 'cancelled', 'timed_out', 'invalid_result', 'permission_blocked', 'orphaned',
]);
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;

function assertRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) throw new Error('Invalid run ID.');
}

function ensureStateDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(stateDir, 0o700);
}

function statePath(stateDir, runId) {
  assertRunId(runId);
  return path.join(stateDir, `${runId}.json`);
}

export function writeState(stateDir, runId, data, { heartbeatOnly = false } = {}) {
  ensureStateDir(stateDir);
  const finalPath = statePath(stateDir, runId);
  const temporaryPath = path.join(stateDir, `.${runId}.${crypto.randomUUID()}.tmp`);
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(finalPath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const now = new Date().toISOString();
  const state = {
    ...data,
    run_id: runId,
    owner_id: SERVER_OWNER_ID,
    controller_pid: process.pid,
    revision: heartbeatOnly ? (previous?.revision || 1) : (previous?.revision || 0) + 1,
    updated_at: heartbeatOnly ? (previous?.updated_at || now) : now,
  };
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, finalPath);
  fs.chmodSync(finalPath, 0o600);
  return state;
}

export function readState(stateDir, runId) {
  const file = statePath(stateDir, runId);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read run state ${runId}: ${error.message}`);
  }
}

export function listStates(stateDir, limit = 100) {
  try {
    return fs.readdirSync(stateDir)
      .filter((name) => name.endsWith('.json') && RUN_ID_PATTERN.test(name.slice(0, -5)))
      .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8')); } catch { return null; }
      })
      .filter(Boolean)
      .sort((left, right) => {
        const rightTime = Date.parse(right.started_at || right.created_at || '') || 0;
        const leftTime = Date.parse(left.started_at || left.created_at || '') || 0;
        return rightTime - leftTime;
      })
      .slice(0, Math.max(1, Math.min(limit, 500)));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function detectOrphans(stateDir) {
  const changed = [];
  for (const state of listStates(stateDir, 500)) {
    if (state.status === 'running' && state.owner_id !== SERVER_OWNER_ID && !isProcessAlive(state.controller_pid)) {
      changed.push(writeState(stateDir, state.run_id, {
        ...state,
        status: 'orphaned',
        ended_at: new Date().toISOString(),
        error: 'The owning MCP server stopped before recording a terminal result.',
      }));
    }
  }
  return changed;
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
