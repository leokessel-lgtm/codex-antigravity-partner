import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import * as yaml from 'js-yaml';
import { sha256 } from './integrity.mjs';
import { assertAllowed, canonicalize } from './paths.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(moduleDir, '..', 'schemas', 'project-config.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = new Ajv({ allErrors: true, useDefaults: true }).compile(schema);

export function loadConfig(configPath) {
  let resolvedConfig;
  let raw;
  try {
    resolvedConfig = fs.realpathSync(path.resolve(configPath));
    raw = fs.readFileSync(resolvedConfig, 'utf8');
  } catch (error) {
    throw new Error(`Could not read project configuration: ${error.message}`);
  }

  let config;
  try {
    config = yaml.load(raw);
  } catch (error) {
    throw new Error(`Invalid YAML in project configuration: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Project configuration must be a YAML object.');
  }
  if (!validate(config)) {
    const detail = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Invalid project configuration: ${detail}`);
  }

  const baseDir = path.dirname(resolvedConfig);
  const normalised = {
    ...config,
    config_path: resolvedConfig,
    config_sha256: sha256(raw),
    workspace_root: canonicalize(config.workspace_root, baseDir),
    allowed_paths: config.allowed_paths.map((candidate) => canonicalize(candidate, baseDir)),
  };
  assertAllowed(normalised.workspace_root, normalised.allowed_paths);
  return normalised;
}
