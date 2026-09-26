import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(pluginRoot, '../..');

test('repository exposes the Antigravity plugin through its local marketplace', {
  skip: !fs.existsSync(path.join(repositoryRoot, '.git')),
}, () => {
  const marketplacePath = path.join(repositoryRoot, '.agents/plugins/marketplace.json');
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  assert.equal(marketplace.name, 'leo-codex-antigravity-partner');
  assert.deepEqual(marketplace.plugins.map(({ name }) => name), ['codex-antigravity-partner']);
  assert.deepEqual(marketplace.plugins[0].source, {
    source: 'local',
    path: './plugins/codex-antigravity-partner',
  });
  assert.equal(marketplace.plugins[0].policy.installation, 'AVAILABLE');
  assert.equal(marketplace.plugins[0].policy.authentication, 'ON_INSTALL');
  const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
  const dependencyInstall = readme.indexOf('npm --prefix plugins/codex-antigravity-partner ci --omit=dev');
  const marketplaceInstall = readme.indexOf('codex plugin marketplace add .');

  assert.ok(dependencyInstall >= 0, 'public install must install runtime dependencies');
  assert.ok(marketplaceInstall > dependencyInstall, 'dependencies must be installed before marketplace registration');
  assert.doesNotMatch(readme, /plugin marketplace add leokessel-lgtm\/codex-antigravity-partner/u);
  for (const file of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, file)), true, `${file} is required`);
  }
  assert.equal(fs.existsSync(path.join(repositoryRoot, '.codex-marketplace')), false);
});
