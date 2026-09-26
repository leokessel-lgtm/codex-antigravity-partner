---
name: codex-antigravity-partner
description: Delegate bounded work from Codex to the local Antigravity headless CLI when explicit model choice, immutable review packets, durable status, cancellation and independently verifiable results are required.
---

# Codex Antigravity Partner

Use the `antigravity_partner` MCP tools for governed headless delegation. Continue using the separate desktop bridge only for tasks that are already open in the Antigravity desktop app.

## Before starting a run

1. Read the target project's `.agent-collab/project.yaml` and applicable project instructions.
2. Call `capabilities` to get the current models. Select the best compatible model for the actual task and tell the user the model and task-specific rationale before `start_run`.
   For connector-dependent tasks, `preflight` can report current named AG MCP enablement and model availability; it cannot establish connector authentication or predict permission outcomes.
3. Keep the scope bounded. Use `sandbox` unless implementation genuinely requires `accept-edits` and the project configuration permits it.
4. Do not send secrets, credentials, identity evidence, account identifiers or private financial records unless the user has authorised that exact transmission.
5. Treat review-packet file reads as expected. Before the first `start_run`, inspect `unattended_approval_eligible` and `review_access_state` in the generated packet output. The controller rejects `review_mode` for an ineligible manifest-bound configuration before spawning AG. Either keep the review prompt self-contained without `review_mode`, or rebuild a non-sensitive packet with `allow_unattended_approval: true` and obtain fresh approval for its new manifest.
6. `allow_unattended_approval: true` makes a packet eligible for a grant; it does not grant authority. Show the user the exact manifest path and SHA-256, file allow-list, model and sandbox scope before asking. Approval is manifest-bound and does not transfer when a packet is rebuilt or its hash changes.
7. After explicit approval for that exact packet, call `create_unattended_grant` with its manifest, manifest-bound configuration and selected model. Pass the returned grant ID to `start_run` with `unattended_approval: true`. The owner-only grant expires, is consumed once and becomes invalid after controller restart. `unattended_approval` uses AG's broad auto-approval flag, so use it only with sandboxed plan mode and non-sensitive material. Never use it for raw financial or identity records.

## Model routing

Choose the least expensive current model that is strong enough for the risk and complexity; “best” does not always mean the largest model.

- Prefer the newest available Flash High variant for bounded single-file extraction, schema-conformance checks, fixtures and routine secondary review.
- Prefer a current Pro High or Sonnet Thinking model for multi-file implementation, substantial synthesis or nuanced evidence reconciliation.
- Prefer the strongest available Opus Thinking model for architecture, security boundaries and adversarial review where the higher latency and usage are justified.
- Escalate only when the smaller model fails a concrete acceptance check. Do not use a large model merely because it is available.

## Operating a run

- `start_run` means the controller started a process. It does not mean AG completed the task.
- `permission_blocked` is terminal and non-retryable without a new packet or changed authority. Changing only the prompt or model does not resolve a read denial.
- For a manifest-bound review that must read packet files, prefer the eligible-packet, exact-approval and single-use-grant path before `start_run`; do not use a failed ordinary run as a permission preflight.
- Use `wait_run` for a bounded wait and `get_run` for a current snapshot. Each wait defaults to 30 seconds and is capped at 45 seconds to stay below common MCP client request timeouts. Call it again only when the run remains active.
- Treat `last_heartbeat` only as controller liveness, not evidence of useful progress. `updated_at` changes only for semantic state transitions.
- Cancel a stalled or superseded run with `cancel_run`. Do not retry a failed mutation without renewed authority.
- A normal MCP transport disconnect, `SIGINT` or `SIGTERM` cancels and immediately terminates runs owned by that controller. Hard crashes and machine failure still cannot be reattached in this version.

## Review packets and evidence

- Build a packet with `npm run build:review-packet -- <packet-spec.yaml> <output-parent>` when selected project files must be reviewed outside their repository. Inspect the exact allow-list before copying sensitive material.
- Review runs must set `review_mode: true`, provide the packet's `review-packet-manifest.json`, and remain in `sandbox` permission.
- Review mode uses only the manifest-bound packet configuration and rejects added directories or a wider workspace policy.
- The controller verifies packet hashes before and after the run. It validates model `source_attestations` against the manifest and rejects finding citations that are not attested.
- Describe this evidence precisely as validated model source attestation. Never call it filesystem, tool-call or kernel-level file-read telemetry.
- After a successful review, use `create_adjudication` to create the separate Codex artefact. Leave decisions unresolved until Codex checks the cited source. Never treat the generated artefact as acceptance by itself.
- Treat elapsed time as controller evidence and token counts as bounded AG-reported metadata, not independent billing telemetry.

## Accepting results

Only `succeeded` has a schema-valid delegated result. The nested result may still say `partial` or `blocked`; report that honestly. Treat `failed`, `timed_out`, `invalid_result`, `permission_blocked`, `cancelled` and `orphaned` as non-completion.

AG output is delegated evidence, not source authority. Inspect changed files and independently rerun material checks before claiming correctness. Commits, deployments, publication, external sends, payments and destructive actions retain their own approval gates.

For the state model, schemas, packet format and deferred limitations, read [the controller contract](../../docs/mvp-contract.md).
