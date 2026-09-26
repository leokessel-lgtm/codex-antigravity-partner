#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { buildReviewPacket } from '../src/review-packet.mjs';

const [specArgument, outputParentArgument] = process.argv.slice(2);
if (!specArgument || !outputParentArgument) {
  throw new Error('Usage: build-review-packet <packet-spec.yaml> <output-parent>');
}
const specPath = path.resolve(specArgument);
const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
const built = buildReviewPacket(spec, path.resolve(outputParentArgument));
process.stdout.write(`${JSON.stringify({
  packet_root: built.packet_root,
  manifest_path: built.manifest_path,
  manifest_sha256: built.manifest_sha256,
  file_count: built.manifest.files.length,
  unattended_approval_eligible: spec.project?.allow_unattended_approval === true,
  review_access_state: spec.project?.allow_unattended_approval === true
    ? 'eligible_for_grant'
    : 'requires_eligible_rebuild',
  review_access_message: spec.project?.allow_unattended_approval === true
    ? 'Show the exact manifest, model and sandbox scope to the user; create a single-use grant only after explicit approval.'
    : 'The controller will reject review mode for this packet. Rebuild an eligible non-sensitive packet, then obtain fresh approval for its new manifest.',
}, null, 2)}\n`);
