import fs from 'node:fs';
import path from 'node:path';

export function canonicalize(candidate, base = process.cwd()) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  const resolved = path.resolve(base, candidate);
  try {
    return fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`Path does not exist: ${resolved} (${error.message})`);
  }
}

export function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertAllowed(candidate, allowedPaths) {
  if (!allowedPaths.some((allowed) => isWithin(candidate, allowed))) {
    throw new Error(`Path ${candidate} is not within the configured allowed paths.`);
  }
}
