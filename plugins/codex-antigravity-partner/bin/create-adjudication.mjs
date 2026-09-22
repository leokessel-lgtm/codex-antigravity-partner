#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildAdjudication } from '../src/adjudication.mjs';
import { verifyReviewPacket } from '../src/review-packet.mjs';

const [stateArgument, manifestArgument, outputArgument] = process.argv.slice(2);
if (!stateArgument || !manifestArgument || !outputArgument) {
  throw new Error('Usage: create-adjudication <run-state.json> <review-packet-manifest.json> <output.json>');
}
const state = JSON.parse(fs.readFileSync(path.resolve(stateArgument), 'utf8'));
const packet = verifyReviewPacket(path.resolve(manifestArgument));
const outputPath = path.resolve(outputArgument);
const artifact = buildAdjudication(state, packet, outputPath);
process.stdout.write(`${JSON.stringify({ output_path: outputPath, run_id: artifact.run_id, status: artifact.status }, null, 2)}\n`);
