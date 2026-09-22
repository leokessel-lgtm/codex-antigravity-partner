# Architecture

This repository contains one Node.js MCP plugin. The repo-local marketplace points to `plugins/codex-antigravity-partner`, whose server invokes the installed `agy` CLI as a bounded child process.

## Project Scope and Configuration

Each run loads `.agent-collab/project.yaml`, validates it against [`project-config.schema.json`](../plugins/codex-antigravity-partner/schemas/project-config.schema.json), resolves canonical absolute paths and rejects scopes outside `allowed_paths`. These paths control the workspace and `--add-dir` arguments passed to Antigravity. They are not an operating-system filesystem sandbox.

```text
Codex MCP call
  -> local configuration and model validation
  -> durable queued/running state
  -> agy child process in the configured workspace
  -> structured-output validation
  -> terminal state and bounded result
```

## MCP Tools

The controller exposes:

- `capabilities`: live models and controller features.
- `start_run`: asynchronous bounded execution.
- `get_run`, `wait_run`, `list_runs`: durable state inspection.
- `cancel_run`: termination of a controller-owned run.
- `create_unattended_grant`: exact-manifest, time-limited, single-use review authority.
- `create_adjudication`: separate unresolved Codex assessment of a successful review.

Mutation-capable tools remain prompted in [`.mcp.json`](../plugins/codex-antigravity-partner/.mcp.json). Detailed arguments and invariants remain canonical in the [MVP contract](../plugins/codex-antigravity-partner/docs/mvp-contract.md).

## State Machine

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelled
                  -> timed_out
                  -> invalid_result
                  -> permission_blocked

running after controller restart -> orphaned
```

Terminal states never transition again. A heartbeat proves controller liveness only. It does not prove useful model progress. A zero process exit is insufficient: only a successful CLI envelope with schema-valid structured output reaches `succeeded`.

## Validated Model Source Attestations vs Operating-System Read Telemetry

Review results may state which packet sources the model consulted. The controller validates those source names and SHA-256 values against the immutable packet manifest and requires cited findings to be attested. This is validated model source attestation only. It is not proof that the process opened a file, kernel telemetry, model identity proof or acceptance of a finding.
