import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { canonicalJson, sha256 } from './integrity.mjs';
import { isWithin } from './paths.mjs';

const PACKET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SPEC_KEYS = new Set(['version', 'packet_id', 'repository_root', 'source_root', 'files', 'project']);
const PROJECT_KEYS = new Set(['project_id', 'sensitivity', 'max_runtime_seconds', 'allowed_models', 'allow_unattended_approval']);

function regularDirectory(candidate, label) {
  const resolved = fs.realpathSync(path.resolve(candidate));
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} must be a directory.`);
  return resolved;
}

function portableRelative(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim() || path.isAbsolute(candidate) || candidate.includes('\\')) {
    throw new Error('Each selected file must be a portable relative path within the source root.');
  }
  const normalised = path.posix.normalize(candidate);
  if (normalised === '.' || normalised === '..' || normalised.startsWith('../')) {
    throw new Error(`Selected path escapes the source root: ${candidate}`);
  }
  return normalised;
}

function assertNoSymlink(root, relativePath) {
  let current = root;
  for (const part of relativePath.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Selected path contains a symlink: ${relativePath}`);
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function readStableSource(sourceRoot, relativePath, hooks = {}) {
  assertNoSymlink(sourceRoot, relativePath);
  const requested = path.join(sourceRoot, ...relativePath.split('/'));
  const resolved = fs.realpathSync(requested);
  if (!isWithin(resolved, sourceRoot)) throw new Error(`Selected path is not within the source root: ${relativePath}`);
  const before = fs.statSync(resolved, { bigint: true });
  if (!before.isFile()) throw new Error(`Selected path is not a regular file: ${relativePath}`);
  hooks.beforeOpen?.(relativePath);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new Error(`Source identity changed before it could be copied: ${relativePath}`);
    }
    const bytes = fs.readFileSync(fd);
    const afterRead = fs.fstatSync(fd, { bigint: true });
    if (!sameFile(opened, afterRead)) throw new Error(`Source changed while it was being read: ${relativePath}`);
    assertNoSymlink(sourceRoot, relativePath);
    const resolvedAfter = fs.realpathSync(requested);
    const namedAfter = fs.statSync(resolvedAfter, { bigint: true });
    if (!isWithin(resolvedAfter, sourceRoot) || !sameFile(opened, namedAfter)) {
      throw new Error(`Source path changed while it was being read: ${relativePath}`);
    }
    return { absolutePath: resolved, bytes, sha256: sha256(bytes), identity: opened };
  } finally {
    fs.closeSync(fd);
  }
}

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Packet specification must be an object.');
  for (const key of Object.keys(spec)) if (!SPEC_KEYS.has(key)) throw new Error(`Unsupported packet field: ${key}`);
  if (spec.version !== 1) throw new Error('Packet specification version must be 1.');
  if (!PACKET_ID.test(spec.packet_id || '')) throw new Error('packet_id must use letters, numbers, dot, underscore or hyphen.');
  if (!Array.isArray(spec.files) || spec.files.length === 0) throw new Error('files must be a non-empty explicit allow-list.');
  if (!spec.project || typeof spec.project !== 'object' || Array.isArray(spec.project)) throw new Error('project must be an object.');
  for (const key of Object.keys(spec.project)) {
    if (!PROJECT_KEYS.has(key)) throw new Error(`Unsupported project field that could widen packet access: ${key}`);
  }
  if (!PACKET_ID.test(spec.project.project_id || '')) throw new Error('project.project_id is invalid.');
  if (!['normal', 'private', 'high'].includes(spec.project.sensitivity || 'private')) throw new Error('project.sensitivity is invalid.');
  if (!Number.isInteger(spec.project.max_runtime_seconds) || spec.project.max_runtime_seconds < 10 || spec.project.max_runtime_seconds > 1800) {
    throw new Error('project.max_runtime_seconds must be an integer from 10 to 1800.');
  }
  if (spec.project.allowed_models !== undefined && (!Array.isArray(spec.project.allowed_models)
    || spec.project.allowed_models.some((model) => typeof model !== 'string' || !model.trim()))) {
    throw new Error('project.allowed_models must contain non-empty model names.');
  }
  if (spec.project.allow_unattended_approval !== undefined && typeof spec.project.allow_unattended_approval !== 'boolean') {
    throw new Error('project.allow_unattended_approval must be boolean.');
  }
}

function projectConfig(spec) {
  return {
    version: 1,
    project_id: spec.project.project_id,
    workspace_root: '..',
    allowed_paths: ['..'],
    allowed_permissions: ['sandbox'],
    sensitivity: spec.project.sensitivity || 'private',
    max_runtime_seconds: spec.project.max_runtime_seconds,
    allow_unattended_approval: spec.project.allow_unattended_approval || false,
    ...(spec.project.allowed_models ? { allowed_models: [...new Set(spec.project.allowed_models)] } : {}),
  };
}

function readonlyTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      readonlyTree(target);
      fs.chmodSync(target, 0o555);
    } else {
      fs.chmodSync(target, 0o444);
    }
  }
  fs.chmodSync(root, 0o555);
}

function makeRemovable(root) {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) makeRemovable(target);
      else if (!entry.isSymbolicLink()) fs.chmodSync(target, 0o600);
    }
    fs.chmodSync(root, 0o700);
  } catch { /* best-effort cleanup follows */ }
}

export function buildReviewPacket(spec, outputParent, hooks = {}) {
  validateSpec(spec);
  const repositoryRoot = regularDirectory(spec.repository_root, 'repository_root');
  const sourceRoot = regularDirectory(spec.source_root, 'source_root');
  if (!isWithin(sourceRoot, repositoryRoot)) throw new Error('source_root must be within repository_root.');

  const resolvedOutputParent = path.resolve(outputParent);
  if (isWithin(resolvedOutputParent, repositoryRoot)) throw new Error('Review packet output must be outside the repository.');
  fs.mkdirSync(resolvedOutputParent, { recursive: true, mode: 0o700 });
  const realOutputParent = fs.realpathSync(resolvedOutputParent);
  if (isWithin(realOutputParent, repositoryRoot)) throw new Error('Review packet output must be outside the repository.');
  const packetRoot = path.join(realOutputParent, spec.packet_id);
  if (fs.existsSync(packetRoot)) throw new Error(`Review packet already exists: ${packetRoot}`);

  const selected = spec.files.map(portableRelative);
  if (new Set(selected).size !== selected.length) throw new Error('Selected files contain a duplicate destination.');
  selected.sort();

  const inputs = selected.map((relativePath) => ({ relativePath, ...readStableSource(sourceRoot, relativePath, hooks) }));

  try {
    fs.mkdirSync(packetRoot, { mode: 0o700 });
    for (const input of inputs) {
      const destination = path.join(packetRoot, 'source', ...input.relativePath.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, input.bytes, { mode: 0o400, flag: 'wx' });
      hooks.afterCopy?.(input.relativePath);
      const current = readStableSource(sourceRoot, input.relativePath);
      if (!sameFile(current.identity, input.identity) || current.sha256 !== input.sha256) {
        throw new Error(`Source changed while the packet was being built: ${input.relativePath}`);
      }
      if (sha256(fs.readFileSync(destination)) !== input.sha256) throw new Error(`Copied bytes failed verification: ${input.relativePath}`);
    }

    const configDir = path.join(packetRoot, '.agent-collab');
    fs.mkdirSync(configDir, { mode: 0o700 });
    const configPath = path.join(configDir, 'project.yaml');
    const configBytes = `${yaml.dump(projectConfig(spec), { noRefs: true, lineWidth: -1, sortKeys: false })}`;
    fs.writeFileSync(configPath, configBytes, { mode: 0o400, flag: 'wx' });
    const manifest = {
      manifest_version: 1,
      packet_id: spec.packet_id,
      authority: 'review packet only; source authority remains with the originating project',
      evidence_limit: 'File hashes prove packet integrity, not model file-read activity.',
      files: inputs.map((input) => ({
        path: `source/${input.relativePath}`,
        sha256: input.sha256,
        bytes: input.bytes.length,
      })),
      project_config: {
        path: '.agent-collab/project.yaml',
        sha256: sha256(configBytes),
        bytes: Buffer.byteLength(configBytes),
      },
    };
    const manifestPath = path.join(packetRoot, 'review-packet-manifest.json');
    const manifestBytes = canonicalJson(manifest);
    fs.writeFileSync(manifestPath, manifestBytes, { mode: 0o400, flag: 'wx' });
    const manifestSha256 = sha256(manifestBytes);
    fs.writeFileSync(path.join(packetRoot, 'review-packet-manifest.sha256'), `${manifestSha256}  review-packet-manifest.json\n`, { mode: 0o400, flag: 'wx' });
    readonlyTree(packetRoot);
    return { packet_root: packetRoot, manifest_path: manifestPath, manifest_sha256: manifestSha256, manifest };
  } catch (error) {
    makeRemovable(packetRoot);
    fs.rmSync(packetRoot, { recursive: true, force: true });
    throw error;
  }
}

export function readReviewPacket(manifestPath) {
  const requested = path.resolve(manifestPath);
  if (fs.lstatSync(requested).isSymbolicLink()) throw new Error('Review packet manifest must not be a symlink.');
  const resolved = fs.realpathSync(requested);
  const bytes = fs.readFileSync(resolved);
  let manifest;
  try { manifest = JSON.parse(bytes); } catch (error) { throw new Error(`Invalid review packet manifest: ${error.message}`); }
  if (manifest?.manifest_version !== 1 || !PACKET_ID.test(manifest?.packet_id || '') || !Array.isArray(manifest.files)) {
    throw new Error('Invalid review packet manifest shape.');
  }
  return { manifest, manifest_path: resolved, manifest_sha256: sha256(bytes), packet_root: path.dirname(resolved) };
}

export function verifyReviewPacket(manifestPath) {
  const loaded = readReviewPacket(manifestPath);
  const entries = [...loaded.manifest.files, loaded.manifest.project_config];
  const checks = entries.map((entry) => {
    try {
      const relativePath = portableRelative(entry.path);
      assertNoSymlink(loaded.packet_root, relativePath);
      const target = fs.realpathSync(path.join(loaded.packet_root, ...relativePath.split('/')));
      if (!isWithin(target, loaded.packet_root) || !fs.statSync(target).isFile()) throw new Error('not a regular packet file');
      const bytes = fs.readFileSync(target);
      const actual = sha256(bytes);
      return { path: entry.path, expected_sha256: entry.sha256, actual_sha256: actual, valid: actual === entry.sha256 && bytes.length === entry.bytes };
    } catch (error) {
      return { path: entry.path, expected_sha256: entry.sha256, actual_sha256: null, valid: false, error: error.message };
    }
  });
  return { ...loaded, valid: checks.every((check) => check.valid), checks, failures: checks.filter((check) => !check.valid) };
}
