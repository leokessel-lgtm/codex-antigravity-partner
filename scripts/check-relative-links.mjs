import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = fs.realpathSync(process.cwd());
const skippedDirectories = new Set(['.git', '.superpowers', 'node_modules']);
const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
let hasErrors = false;

function isInsideRepository(candidate) {
  const relative = path.relative(repositoryRoot, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function markdownFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      markdownFiles(entryPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }
  return files;
}

function report(source, rawLink, reason) {
  console.error(`Error: ${reason} in ${path.relative(repositoryRoot, source)} -> ${rawLink}`);
  hasErrors = true;
}

for (const source of markdownFiles(repositoryRoot)) {
  const content = fs.readFileSync(source, 'utf8');
  let match;

  while ((match = markdownLink.exec(content)) !== null) {
    const rawLink = match[1].trim();
    if (!rawLink || rawLink.startsWith('#') || rawLink.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(rawLink)) {
      continue;
    }

    const withoutSuffix = rawLink.split(/[?#]/, 1)[0];
    const encodedPath = withoutSuffix.startsWith('<') && withoutSuffix.endsWith('>')
      ? withoutSuffix.slice(1, -1)
      : withoutSuffix;
    if (!encodedPath) continue;

    let localPath;
    try {
      localPath = decodeURIComponent(encodedPath);
    } catch {
      report(source, rawLink, 'Malformed URL encoding');
      continue;
    }

    const target = localPath.startsWith('/')
      ? path.resolve(repositoryRoot, `.${localPath}`)
      : path.resolve(path.dirname(source), localPath);

    if (!isInsideRepository(target)) {
      report(source, rawLink, 'Link escapes repository root');
      continue;
    }

    if (!fs.existsSync(target)) {
      report(source, rawLink, 'Missing local target');
      continue;
    }

    const resolvedTarget = fs.realpathSync(target);
    if (!isInsideRepository(resolvedTarget)) {
      report(source, rawLink, 'Link escapes repository root');
    }
  }
}

if (hasErrors) {
  process.exitCode = 1;
} else {
  console.log('All relative links are valid.');
}
