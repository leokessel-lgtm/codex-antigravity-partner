# Contributing

This repository is private and intentionally unlicensed. It does not accept public contributions.

## Testing

Use Node.js 20 or later. Run `npm ci` and `npm run check` from `plugins/codex-antigravity-partner`, then run `node scripts/check-relative-links.mjs` from the repository root. Tests must use the fake CLI and never call the live Antigravity service.

Keep package, server and plugin-manifest versions aligned. Preserve prompted mutation tools, path validation, packet integrity, grant binding, durable terminal states and separate unresolved adjudication. Do not commit credentials, private packets, installed dependencies or local run state.

Use the [MVP contract](plugins/codex-antigravity-partner/docs/mvp-contract.md) as the source-of-truth for behavioural changes.
