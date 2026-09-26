# Codex Antigravity Partner

Public, repo-local Codex marketplace for bounded Antigravity headless work. The plugin adds a local controller with explicit model selection, project scope, durable run state, cancellation, review packets and separate Codex adjudication.

The repository is intentionally unlicensed. Public visibility permits inspection and cloning but does not grant a general right to copy, redistribute, publish or create derivative works from the code.

## Prerequisites

To install and use the plugin, you need:

- Git access to `github.com`.
- Your own installed and authenticated `agy` CLI.
- Codex with plugin marketplace support.
- Node.js 20 or later.

## Installation

Clone the pinned release, install the local MCP server dependencies, then add the checked-out marketplace:

```bash
git clone --branch v0.3.3 --depth 1 https://github.com/leokessel-lgtm/codex-antigravity-partner.git
cd codex-antigravity-partner
npm --prefix plugins/codex-antigravity-partner ci --omit=dev
codex plugin marketplace add .
codex plugin add codex-antigravity-partner@leo-codex-antigravity-partner
```

Keep the checkout while the marketplace is configured. A direct Git marketplace install does not install this local Node MCP server's dependencies; the explicit `npm ci --omit=dev` step is required.

Public repository access and Antigravity authentication are separate. The plugin invokes your installed `agy` executable and does not include or copy credentials.

## How it works

1. A project configuration sets the workspace, allowed paths, permissions, runtime and optional model allow-list.
2. `capabilities` reports the live models before a run is started.
3. `start_run` launches one bounded process and returns immediately. Completion is determined from durable state, not process creation.
4. `wait_run` or `get_run` returns the terminal result. Only `succeeded` means the structured result passed controller validation.
5. Review work uses an immutable packet, exact manifest binding and, when explicitly approved, a short-lived single-use grant.
6. `preflight` can inspect local model and AG MCP inventory and verify a review packet before a run. It reports authentication and permission outcomes as unverified.

Sandbox mode uses Antigravity plan mode. Edit-enabled work requires explicit `accept-edits` permission in both project policy and the individual run. Review mode is always sandbox-only.

The desktop bridge is a separate local CDP tool for tasks already open in Antigravity. AG remote-control daemon state is not the bridge's availability test. JEV may provide an optional prompted evaluation or routing opinion in Codex; it is not a runtime dependency of this controller and does not choose models or grant permissions automatically.

## Documentation

- [Architecture](docs/architecture.md)
- [Governance and privacy](docs/governance-and-privacy.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Canonical controller contract](plugins/codex-antigravity-partner/docs/mvp-contract.md)
- [Plugin package](plugins/codex-antigravity-partner/README.md)

## Development

```bash
cd plugins/codex-antigravity-partner
npm ci
npm run check
```

The test suite uses a fake `agy` executable. It must not call the live Antigravity service.
