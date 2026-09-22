import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_OWNER_ID } from './state.mjs';

const GRANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 1800;

function assertGrantId(grantId) {
  if (typeof grantId !== 'string' || !GRANT_ID_PATTERN.test(grantId)) {
    throw new Error('Invalid unattended grant ID.');
  }
}

function assertBinding({ manifestSha256, model, permission }) {
  if (typeof manifestSha256 !== 'string' || !SHA256_PATTERN.test(manifestSha256)) {
    throw new Error('A valid review packet manifest SHA-256 is required.');
  }
  if (typeof model !== 'string' || !model.trim()) throw new Error('A model is required for the unattended grant.');
  if (permission !== 'sandbox') throw new Error('Unattended grants are permitted only for sandboxed review runs.');
}

function grantDir(stateDir) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('State directory is required.');
  const directory = path.join(stateDir, 'grants');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return directory;
}

function grantPath(stateDir, grantId, suffix = '.json') {
  assertGrantId(grantId);
  return path.join(grantDir(stateDir), `${grantId}${suffix}`);
}

function writeOwnerOnly(target, value, { noOverwrite = false } = {}) {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(temporary, 0o600);
  try {
    if (noOverwrite && fs.existsSync(target)) throw new Error(`Unattended grant already exists: ${path.basename(target)}`);
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* already moved or absent */ }
    throw error;
  }
}

export function createUnattendedGrant({
  stateDir,
  manifestSha256,
  model,
  permission = 'sandbox',
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  assertBinding({ manifestSha256, model, permission });
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error(`Grant lifetime must be an integer from 30 to ${MAX_TTL_SECONDS} seconds.`);
  }
  const now = new Date();
  const grant = {
    grant_id: crypto.randomUUID(),
    manifest_sha256: manifestSha256.toLowerCase(),
    model: model.trim(),
    permission,
    owner_id: SERVER_OWNER_ID,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
  const target = grantPath(stateDir, grant.grant_id);
  writeOwnerOnly(target, grant, { noOverwrite: true });
  return { grant_path: target, grant };
}

export function consumeUnattendedGrant({ stateDir, grantId, manifestSha256, model, permission = 'sandbox' }) {
  assertBinding({ manifestSha256, model, permission });
  const target = grantPath(stateDir, grantId);
  const consumedPath = grantPath(stateDir, grantId, '.consumed.json');
  let grant;
  try {
    grant = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (fs.existsSync(consumedPath)) throw new Error('Unattended grant has already been consumed.');
      throw new Error('Unattended grant is not available.');
    }
    throw new Error(`Could not read unattended grant: ${error.message}`);
  }
  if (grant.grant_id !== grantId) throw new Error('Stored unattended grant ID does not match the requested grant ID.');
  if (grant.owner_id !== SERVER_OWNER_ID) throw new Error('Unattended grant belongs to a different controller process.');
  if (grant.manifest_sha256 !== manifestSha256.toLowerCase()) throw new Error('Unattended grant does not match the review manifest.');
  if (grant.model !== model.trim()) throw new Error('Unattended grant does not match the selected model.');
  if (grant.permission !== permission) throw new Error('Unattended grant does not match the requested permission.');
  if (!Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) <= Date.now()) {
    throw new Error('Unattended grant has expired.');
  }

  try {
    fs.renameSync(target, consumedPath);
  } catch (error) {
    if (error.code === 'ENOENT' || fs.existsSync(consumedPath)) {
      throw new Error('Unattended grant has already been consumed.');
    }
    throw error;
  }
  const consumed = { ...grant, consumed: true, consumed_at: new Date().toISOString() };
  writeOwnerOnly(consumedPath, consumed);
  return consumed;
}
