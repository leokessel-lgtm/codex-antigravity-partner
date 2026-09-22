# Codex Antigravity Partner Plugin

This package provides a local control plane for bounded Antigravity headless work. It validates project scope and model choice, starts asynchronous runs, records durable state, supports cancellation and timeouts, and validates structured completion.

## Overview

The MCP server exposes `capabilities`, run lifecycle tools, exact-manifest grant creation and separate unresolved adjudication. Sandboxed and edit-enabled ordinary runs are distinct. Review mode is sandbox-only and binds the run to an immutable packet.

## Trust and State Contract

The [MVP contract](docs/mvp-contract.md) is the source-of-truth for trust boundaries, state transitions, packet integrity and deferred limitations.

## Model Instructions

Operational routing lives in [`skills/codex-antigravity-partner/SKILL.md`](skills/codex-antigravity-partner/SKILL.md) and its linked contract. Documentation here does not replace action-time authority.

## Development and Testing

```bash
npm ci
npm run check
```

Tests use `test/fixtures/fake-agy.mjs` and must never invoke the live service. See repository [troubleshooting](../../docs/troubleshooting.md) and [contribution rules](../../CONTRIBUTING.md).
