#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (process.env.FAKE_AGY_LOG) {
  fs.appendFileSync(process.env.FAKE_AGY_LOG, `${JSON.stringify(args)}\n`);
}

if (args[0] === 'models') {
  if (process.env.FAKE_AGY_RESTORE_CONFIG_SOURCE && process.env.FAKE_AGY_RESTORE_CONFIG_TARGET) {
    fs.copyFileSync(process.env.FAKE_AGY_RESTORE_CONFIG_SOURCE, process.env.FAKE_AGY_RESTORE_CONFIG_TARGET);
  }
  process.stdout.write('gemini-test-pro\tGemini Test Pro (High)\nclaude-test-thinking\tClaude Test (Thinking)\n');
  process.exit(0);
}
if (args[0] === '--version') {
  process.stdout.write('fake-agy 1.0\n');
  process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'list') {
  if (process.env.FAKE_AGY_MCP_LIST_FAIL === '1') process.exit(1);
  process.stdout.write('NAME                    TYPE  STATUS    COMMAND/URL\n');
  process.stdout.write('home-developer          http  enabled   https://example.invalid/private\n');
  process.stdout.write('android-management      http  disabled  https://example.invalid/android\n');
  process.exit(0);
}

const promptArgument = args.find((argument) => argument.startsWith('--print='));
const prompt = promptArgument?.slice('--print='.length) || '';
let validResult = {
  status: 'completed',
  summary: 'The bounded delegated task completed with a structured result.',
  changed_files: [],
  checks: [],
  risks: [],
  findings: [{
    title: 'Fixture finding',
    claim: 'The fixture returned a structured evidence item.',
    classification: 'observed',
    confidence: 'high',
    evidence: [{ source: 'fixture', locator: 'line 1', basis: 'The fixture defines this item.' }],
    implication: 'The controller can carry evidence-bearing review results.',
    next_step: 'No action required.',
  }],
  artifacts: [],
  needs_user_action: false,
};

const reviewMatch = prompt.match(/\[CONTROLLER_REVIEW_PACKET\]\n([^\n]+)\n\[\/CONTROLLER_REVIEW_PACKET\]/);
if (reviewMatch) {
  const review = JSON.parse(reviewMatch[1]);
  const first = review.sources[0];
  validResult = {
    ...validResult,
    findings: validResult.findings.map((finding) => ({
      ...finding,
      evidence: [{ ...finding.evidence[0], source: first.source }],
    })),
    ...(!prompt.includes('[review-missing-attestation]') ? {
      source_attestations: [{ source: first.source, sha256: first.sha256, basis: 'Consulted for the fixture finding.' }],
    } : {}),
  };
}

if (prompt.includes('[review-sleep]')) {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ status: 'SUCCESS', structured_output: validResult, denied_actions: [] }));
  }, 200);
} else if (prompt.includes('[leader-exits-child-ignores-term]')) {
  const descendantScript = [
    "const fs = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    "fs.writeFileSync(process.env.FAKE_AGY_DESCENDANT_PID_FILE, String(process.pid));",
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const descendant = spawn(process.execPath, [
    '-e',
    descendantScript,
  ], { env: process.env, stdio: 'ignore' });
  descendant.unref();
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1_000);
} else if (prompt.includes('[sleep]')) {
  const timer = setTimeout(() => {
    process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify(validResult), denied_actions: [] }));
  }, 10_000);
  process.on('SIGTERM', () => {
    clearTimeout(timer);
    process.exit(143);
  });
} else if (prompt.includes('[fail]')) {
  process.stderr.write('simulated failure\n');
  process.exit(7);
} else if (prompt.includes('[empty]')) {
  process.stdout.write('');
} else if (prompt.includes('[narration]')) {
  process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: 'I will inspect the files now.' }));
} else if (prompt.includes('[malformed-result]')) {
  process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: JSON.stringify({ summary: 'Incomplete shape' }) }));
} else if (prompt.includes('[agent-error]')) {
  process.stdout.write(JSON.stringify({ status: 'ERROR', error: 'simulated agent error', denied_actions: [] }));
} else if (prompt.includes('[denied-read-failed]')) {
  process.stdout.write(JSON.stringify({
    status: 'ERROR',
    error: 'read permission was denied',
    denied_actions: [{ action: 'read_file', display_name: 'ViewFile' }],
  }));
} else if (prompt.includes('[denied-read-invalid]')) {
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: 'I could not inspect the packet.',
    denied_actions: [{ action: 'read_file', display_name: 'ListDir' }],
  }));
} else if (prompt.includes('[denied-write-only]')) {
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: 'I could not edit the file.',
    denied_actions: [{ action: 'write_file', display_name: 'WriteFile' }],
  }));
} else if (prompt.includes('[denied-url-only]')) {
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: 'I could not read the URL.',
    denied_actions: [{ action: 'read_url', display_name: 'WebFetch' }],
  }));
} else if (prompt.includes('[denied-command-only]')) {
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: 'I could not run the command.',
    denied_actions: [{ action: 'run_command', display_name: 'Shell' }],
  }));
} else if (prompt.includes('[denied-missing-action]')) {
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    response: 'An unnamed action was denied.',
    denied_actions: [{}],
  }));
} else {
  const noisyResponse = { ...validResult, toolAction: 'Internal display text', toolSummary: 'Internal display summary' };
  process.stdout.write(JSON.stringify({
    conversation_id: '00000000-0000-4000-8000-000000000001',
    status: 'SUCCESS',
    response: JSON.stringify(noisyResponse),
    structured_output: validResult,
    usage: prompt.includes('[usage-noise]')
      ? { input_tokens: 10, output_tokens: -1, total_tokens: 42, transcript: 'PROMPT-IN-USAGE', infinity: Infinity }
      : { total_tokens: 42 },
    denied_actions: [],
  }));
}
