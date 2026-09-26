import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { listModels } from './models.mjs';
import { verifyReviewPacket } from './review-packet.mjs';

function readMcpInventory(agyCli) {
  const result = spawnSync(agyCli, ['mcp', 'list'], {
    encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  const lines = (result.stdout || '').trim().split(/\r?\n/);
  if (!/^NAME\s+TYPE\s+STATUS\s+/i.test(lines[0] || '')) return null;
  const inventory = new Map();
  for (const line of lines.slice(1)) {
    const columns = line.trim().split(/\s{2,}/);
    if (columns.length < 3 || !['enabled', 'disabled'].includes(columns[2])) return null;
    inventory.set(columns[0], columns[2]);
  }
  return inventory;
}

export function observePreflight({ configPath, model, requiredMcpServers = [], reviewManifestPath, agyCli = 'agy' }) {
  const config = loadConfig(configPath);
  let availableModels = null;
  try { availableModels = listModels(agyCli); } catch { /* availability is unknown */ }
  const inventory = readMcpInventory(agyCli);
  const mcpServers = Object.fromEntries(requiredMcpServers.map((name) => [
    name, inventory ? (inventory.get(name) || 'missing') : 'unknown',
  ]));
  let packet;
  if (reviewManifestPath) {
    try {
      const verified = verifyReviewPacket(reviewManifestPath);
      packet = {
        integrity: verified.valid ? 'valid' : 'invalid',
        config_bound: verified.valid
          && config.config_path === path.join(verified.packet_root, verified.manifest.project_config.path)
          && config.config_sha256 === verified.manifest.project_config.sha256
          && config.workspace_root === verified.packet_root,
      };
    } catch {
      packet = { integrity: 'invalid', config_bound: false };
    }
  }
  return {
    project_id: config.project_id,
    model: {
      name: model,
      available: availableModels ? availableModels.includes(model) : null,
      allowed_by_project: !config.allowed_models?.length || config.allowed_models.includes(model),
    },
    mcp_inventory: inventory ? 'observed' : 'unavailable',
    mcp_servers: mcpServers,
    ...(packet ? { packet } : {}),
    config_allows_unattended_approval: config.allow_unattended_approval,
    permission_outcome: 'unverified',
    connector_authentication: 'unverified',
  };
}
