import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('plugin contract keeps prompted mutations and release metadata aligned', () => {
  const plugin = JSON.parse(fs.readFileSync('.codex-plugin/plugin.json', 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const mcp = JSON.parse(fs.readFileSync('.mcp.json', 'utf8'));

  assert.equal(plugin.name, 'codex-antigravity-partner');
  assert.match(plugin.version, new RegExp(`^${packageJson.version.replaceAll('.', '\\.')}\\+codex\\.\\d{14}$`, 'u'));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.engines.node, '>=20.0.0');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(plugin.repository, 'https://github.com/leokessel-lgtm/codex-antigravity-partner');
  assert.equal(plugin.homepage, 'https://github.com/leokessel-lgtm/codex-antigravity-partner#readme');
  assert.equal(plugin.author.url, 'https://github.com/leokessel-lgtm');

  const promptedTools = Object.entries(mcp.mcpServers.antigravity_partner.tools)
    .filter(([, config]) => config.approval_mode === 'prompt')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(promptedTools, [
    'cancel_run',
    'create_adjudication',
    'create_unattended_grant',
    'start_run',
  ]);
});
