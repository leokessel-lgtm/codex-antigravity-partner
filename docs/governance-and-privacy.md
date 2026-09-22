# Governance and Privacy

The controller makes delegated work inspectable without turning delegated narration into authority. The [MVP contract](../plugins/codex-antigravity-partner/docs/mvp-contract.md) is canonical when this summary differs.

## Prerequisites

The plugin invokes the collaborator's installed and authenticated `agy` executable. It does not read or distribute Antigravity credentials. Prompts are not persisted in controller state, but the current CLI receives a prompt as a process argument, so another privileged local process could observe it while the run is active.

Do not use this controller for credentials, raw high-sensitivity records or unnecessary personal information. Project scope constrains controller arguments; Antigravity remains responsible for its sandbox and permissions.

## Access and Authorisation

- Ordinary runs require explicit model selection and a task-specific rationale.
- `accept-edits` must be allowed by project policy and selected on the individual run.
- Review mode is sandbox-only and must use the packet's exact manifest-bound configuration.
- Packet eligibility for unattended work is not approval. A fresh grant requires explicit approval for the exact manifest hash, model and sandbox permission.
- Grants are owner-only, expire, are consumed atomically once and become invalid after controller restart.
- Unattended approval uses the CLI's broad auto-approval flag and is unsuitable for secrets or high-sensitivity material.

## Lifecycles and Interventions

- Cancellation terminates a run owned by the active controller, escalating from graceful to forced termination after a short grace period.
- Deadline expiry produces `timed_out` and terminates the child process.
- A persisted `running` state from a prior controller becomes `orphaned`; this version cannot reattach after a hard crash or machine failure.
- `permission_blocked` is terminal and non-retryable without changed packet or authority.
- Only schema-valid structured output can reach `succeeded`; that output may still report a partial or blocked delegated outcome.

## Evidence and adjudication

Packet hashes and validated model source attestations improve provenance but are not filesystem read telemetry. AG findings remain delegated evidence. `create_adjudication` writes a separate artefact with every `codex_decision` unresolved; Codex must inspect the cited source before accepting or rejecting a finding.

Plugin code, manifests, schemas and the MVP contract are source-of-truth. Tests and validated run records are current evidence. Templates are reusable samples. Installed caches, generated brain artefacts, packets, grants and run state are excluded local material.
