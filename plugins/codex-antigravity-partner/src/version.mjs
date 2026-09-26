import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const packageVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const pluginVersion = JSON.parse(fs.readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8')).version;

export const CONTROLLER_VERSION = packageVersion;
export const PLUGIN_VERSION = pluginVersion;

export function readAgyCliVersion(agyCli) {
  const result = spawnSync(agyCli, ['--version'], {
    encoding: 'utf8', shell: false, timeout: 3_000, maxBuffer: 4_096,
  });
  if (result.error || result.status !== 0) return null;
  const firstLine = (result.stdout || '').trim().split(/\r?\n/, 1)[0];
  return firstLine.match(/\b\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?\b/)?.[0] || null;
}
