import { spawnSync } from 'node:child_process';

function parseModelOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean);
    }
  } catch {
    // The current CLI emits tab-separated model ID and display name.
  }
  return trimmed.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.includes('\t'))
    .map((line) => line.split('\t', 1)[0].trim())
    .filter(Boolean);
}

export function listModels(agyCli = 'agy') {
  const result = spawnSync(agyCli, ['models'], {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw new Error(`Failed to list Antigravity models: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Antigravity model discovery exited with code ${result.status}.`);
  const models = parseModelOutput(result.stdout || '');
  if (!models.length) throw new Error('Antigravity model discovery returned no model IDs.');
  return models;
}

export function validateModel(model, agyCli, allowedModels = []) {
  const available = listModels(agyCli);
  if (!available.includes(model)) throw new Error(`Model ${model} is not currently available in Antigravity.`);
  if (allowedModels.length && !allowedModels.includes(model)) {
    throw new Error(`Model ${model} is not allowed by the project configuration.`);
  }
  return available;
}
