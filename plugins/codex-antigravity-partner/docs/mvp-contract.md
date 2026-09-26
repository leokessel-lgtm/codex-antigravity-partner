# Codex Antigravity Partner contract

## Purpose

Provide a local, auditable control plane for bounded Antigravity headless work. The plugin must make stale, silent and incomplete delegated work visible instead of treating process existence or a zero exit code as successful completion.

## Trust boundary

- The plugin invokes the installed `agy` executable. It never reads Antigravity credentials or private internal APIs.
- Every run requires an explicit model and a task-specific model rationale.
- Execution retains the AG terminal sandbox. Edit permission is an explicit per-run choice.
- Unattended tool approval is off by default. Non-review runs require project policy and individual sandboxed-plan opt-in. Review runs additionally require a short-lived, single-use grant bound to the exact manifest hash, model and sandbox permission. The current CLI implements the final execution flag with `--dangerously-skip-permissions`, so it is unsuitable for secrets or high-sensitivity records even when enabled.
- Workspace and added directories must resolve to absolute paths allowed by the project configuration.
- Secrets and personal data must not be written to run metadata. Prompts are not persisted by default.
- Configured paths govern the working directory and `--add-dir` arguments passed to AG. They are not an operating-system filesystem sandbox; the AG CLI remains responsible for enforcing its sandbox and permission model.
- The current `agy --print` interface receives the prompt as a process argument. The plugin does not persist it, but another privileged local process could observe it while the run is active. Do not use this MVP for secrets or raw high-sensitivity records.
- Commits, deployment, publication, payments, bookings, external sends and destructive operations remain outside this MVP.
- Review-packet hashes and validated model attestations strengthen provenance but are not an operating-system sandbox or filesystem read telemetry.

## State machine

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelled
                  -> timed_out
                  -> invalid_result
                  -> permission_blocked

running after server restart -> orphaned
```

Terminal states never transition again. State snapshots are written atomically with owner-only permissions. A heartbeat records that the local controller is alive; it is not proof that AG is making useful progress.

## MCP tools

### `capabilities`

Reports the `agy` executable, available models and supported partner features. This is read-only.

### `preflight`

Reports the selected model's current CLI availability and project allow-list status, the enabled/disabled/missing state of named AG MCP servers from `agy mcp list`, and optional review-packet integrity and exact configuration binding. An unreadable MCP inventory returns `unknown`, not `missing`. It returns no connector URL and never invokes a connector, starts a run or creates a grant. `config_allows_unattended_approval` is only a project setting; `permission_outcome` and `connector_authentication` remain `unverified`.

### `start_run`

Starts one bounded asynchronous run. Required inputs include project configuration, prompt, model and model rationale. Returns immediately with the run ID and effective scope. A successful start is not successful task completion.

Review work must set `review_mode: true` and provide `review_packet_manifest`. Review mode is sandbox-only. The controller verifies every packet file and the generated project configuration before spawning, binds the manifest hash to durable run state, and verifies the packet again before accepting output.
The loaded project configuration must be the packet's exact canonical path and its parsed bytes must match the manifest hash. Review mode rejects additional paths and a configuration whose resolved workspace or allow-list is wider than the packet root.
Before spawning AG, review mode also requires the verified manifest-bound configuration to set `allow_unattended_approval: true`. An ineligible packet fails locally with rebuild and fresh-approval guidance. Eligibility is not authority: unattended execution still requires explicit approval for the exact manifest, a fresh single-use grant and per-run opt-in.

When a failed or structurally invalid result reports a denied `read_file`, `ViewFile` or `ListDir` action, the run ends as `permission_blocked` with `reason_code: read_permission_denied`, `retryable: false`, a read denial class and required-change guidance. A valid structured result is not reclassified merely because it reports another denied action.

Before spawning a review, the controller rejects a prior `permission_blocked` run with the same manifest hash, permission and authority identity. Changing the prompt or model does not bypass an attended denial. A new packet or newly issued unattended grant is a changed authority state.

An unattended review must pass both `unattended_approval: true` and a fresh `unattended_grant_id`. The grant is consumed after all ordinary validation and packet verification but before the run state is queued. Consumption is fail closed: an infrastructure failure after consumption requires a new explicit grant.

### `create_unattended_grant`

Creates an owner-only grant after explicit user approval for a concrete review. The tool revalidates the packet, requires its exact manifest-bound project configuration, confirms project opt-in and live model eligibility, then binds the grant to the manifest SHA-256, selected model and sandbox permission. Grants expire after 10 minutes by default, may live for at most 30 minutes, are consumed atomically once and do not survive a controller restart.

### `get_run`

Returns current state, timestamps, effective model/scope, denied actions, validation status and a bounded result or error. It never exposes a persisted prompt.

New run records have `state_format_version: 2`, `controller_version`, `plugin_version` and a bounded `agy_cli_version` or `null`. Terminal errors include `failure_stage` where the controller can identify the stage. A malformed structured result with a denied file read retains `structured_output_parse` as its stage and `permission_blocked` as its terminal status. Older records remain readable without fabricated metadata.

### `wait_run`

Waits up to 45 seconds for a semantic state change or terminal result, then returns the same shape as `get_run`. The 30-second default and 45-second maximum stay below the common 60-second MCP request timeout. Call it again with the returned `updated_at` when the run remains active.

### `cancel_run`

Terminates the owned process group, first gracefully and then forcibly after a short grace period. Returns the resulting state.

### `list_runs`

Returns bounded summaries of recent runs without prompts or full response bodies.

### `create_adjudication`

Creates a separate owner-only JSON artefact for a successful, validated review. Every AG finding is copied as delegated evidence with `codex_decision: unresolved`; the tool never accepts a finding on Codex's behalf. The artefact binds the packet manifest and AG result by SHA-256 and records elapsed time and token metadata.

## Review packets

`npm run build:review-packet -- <packet-spec.yaml> <output-parent>` copies an explicit allow-list of regular files to a new packet outside the declared repository root. It rejects path escapes, symlinks, directories, duplicate destinations, overwrite attempts, output within the repository, unsupported project fields and source changes detected during copying. It writes a canonical manifest, a manifest checksum and a sandbox-only `.agent-collab/project.yaml`, then makes the packet read-only.

The packet spec is version 1 and contains `packet_id`, absolute `repository_root`, absolute `source_root`, `files`, and a bounded `project` object. `templates/review-packet.yaml` is the canonical example. `allow_unattended_approval` remains false unless the spec explicitly opts in. For review runs, that project capability does not confer authority by itself: a fresh packet-bound grant and per-run opt-in are also required.

Review results may contain `source_attestations` with relative source, manifest SHA-256 and the model's basis for saying it consulted the source. The controller validates that attested sources exist in the packet, hashes match, and every structured finding citation is attested. This is validated model attestation only. It does not prove a process opened a file.

Usage is AG-reported metadata rather than independently metered usage. The controller retains only finite, non-negative integer token counters from its fixed allow-list and discards unknown fields before durable persistence.

`npm run create:adjudication -- <run-state.json> <manifest.json> <output.json>` provides the same no-overwrite adjudication format for offline workflows.

## Completion contract

`agy` must receive `schemas/delegated-result.schema.json`. Exit code zero is necessary but insufficient. The run becomes `succeeded` only when the CLI envelope reports success and its `structured_output` validates against the schema. The human-facing response is a compatibility fallback only. Empty output, progress-only narration or malformed structured output becomes `invalid_result`, unless a reported read denial makes the more specific terminal state `permission_blocked`. Review tasks should populate the optional structured `findings` collection with classification, confidence and source locators; implementation tasks should use `changed_files`, `checks` and optional `artifacts`.

## Project configuration

The configuration is `.agent-collab/project.yaml`, validated against `schemas/project-config.schema.json`. Paths are relative to the configuration directory unless absolute. The configured workspace root and allowed added directories govern the scope passed to AG. The default permission is `sandbox`; `accept-edits` must be explicitly allowed by both configuration and each run. `allow_unattended_approval` defaults to false and still requires explicit opt-in on the individual run.

## Acceptance

- Valid sandboxed and edit-enabled mock runs reach `succeeded` with validated output.
- Missing model rationale is rejected before spawning.
- Unavailable models are rejected before spawning.
- Disallowed paths and edit mode are rejected before spawning.
- Unattended approval is never passed by default and is rejected with `accept-edits`. Review runs require project opt-in, an exact single-use grant and per-run opt-in; non-review runs retain the existing two-key control.
- Review mode rejects an ineligible manifest-bound configuration before spawning AG, so a predictable read denial is not used as a permission preflight.
- Read denials on failed or invalid output reach `permission_blocked` with stable remediation fields.
- Identical permission-blocked review retries are rejected before spawn unless the packet or authority identity changes.
- Unattended review grants are owner-only, time-limited, manifest/model/sandbox-bound, process-scoped and consumed once.
- Empty or narration-only success output reaches `invalid_result`.
- Non-zero exit reaches `failed`; deadline expiry reaches `timed_out`.
- Cancellation reaches `cancelled` and stops the owned child process.
- State writes are atomic and owner-only.
- A persisted `running` state not owned by the current server is exposed as `orphaned` on startup.
- Closing the MCP transport cancels runs owned by that controller and immediately kills their process groups, preventing a normal client disconnect from leaving detached AG work behind.
- Unit tests do not call the real Antigravity service.
- Packet construction and review result validation fail closed on the Stage 2 cases described above.
- A packet changed after run preflight cannot reach `succeeded`.
- Codex adjudication remains a separate unresolved artefact.

## Deferred beyond MVP

- Reattaching to a live process after a hard crash, `SIGKILL` or machine failure. Normal transport closure, `SIGINT` and `SIGTERM` cancel owned runs instead.
- Concurrent-run scheduling and quotas.
- Streaming semantic progress rather than controller heartbeat. Heartbeat writes do not count as semantic state updates.
- Encrypted prompt or full-transcript retention.
- Desktop CDP adapter integration.
- Automatic project bootstrap or permission escalation.
- Kernel-level or operating-system file-read telemetry.
