import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-relative-links.mjs', import.meta.url));
const temporaryDirectories = [];

function fixture(markdown, configure = () => {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'relative-links-'));
  temporaryDirectories.push(parent);
  const repository = path.join(parent, 'repo');
  fs.mkdirSync(path.join(repository, 'scripts'), { recursive: true });
  fs.copyFileSync(checker, path.join(repository, 'scripts/check-relative-links.mjs'));
  fs.writeFileSync(path.join(repository, 'README.md'), markdown);
  configure({ parent, repository });
  return repository;
}

function run(repository) {
  return spawnSync(process.execPath, ['scripts/check-relative-links.mjs'], {
    cwd: repository,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('accepts an existing relative target', () => {
  const repository = fixture('[Guide](docs/guide.md)', ({ repository }) => {
    fs.mkdirSync(path.join(repository, 'docs'));
    fs.writeFileSync(path.join(repository, 'docs/guide.md'), '# Guide\n');
  });

  assert.equal(run(repository).status, 0);
});

test('rejects a missing relative target', () => {
  const result = run(fixture('[Missing](docs/missing.md)'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing local target/);
});

test('rejects a sibling path whose name begins with the repository name', () => {
  const repository = fixture('[Secret](../repo-other/secret.md)', ({ parent }) => {
    fs.mkdirSync(path.join(parent, 'repo-other'));
    fs.writeFileSync(path.join(parent, 'repo-other/secret.md'), 'outside\n');
  });

  const result = run(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /escapes repository root/);
});

test('rejects a symlink whose resolved target escapes the repository', () => {
  const repository = fixture('[Secret](external/secret.md)', ({ parent, repository }) => {
    fs.mkdirSync(path.join(parent, 'outside'));
    fs.writeFileSync(path.join(parent, 'outside/secret.md'), 'outside\n');
    fs.symlinkSync(path.join(parent, 'outside'), path.join(repository, 'external'));
  });

  const result = run(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /escapes repository root/);
});

test('rejects file and unsupported URI schemes', () => {
  for (const link of ['file:///tmp/secret.md', 'custom:opaque-value']) {
    const result = run(fixture(`[External](${link})`));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported URI scheme/);
  }
});
