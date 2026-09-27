# Governance and Privacy

The controller makes delegated work inspectable without turning delegated narration into authority. The [MVP contract](../plugins/codex-antigravity-partner/docs/mvp-contract.md) is canonical when this summary differs.

The observational `preflight` reads local AG model and MCP inventory and may verify an explicitly supplied packet. It returns connector names and enabled states, never connector URLs or credentials. Enabled does not mean authenticated, reachable or permitted by AG at run time. JEV is an optional external, potentially billable advisory evaluator in Codex, not a runtime dependency or automatic router in this plugin.

## Prerequisites

The plugin invokes the collaborator's installed and authenticated `agy` executable. It does not read or distribute Antigravity credentials. Prompts are not persisted in controller state, but the current CLI receives a prompt as a process argument, so another privileged local process could observe it while the run is active.

Private records, including credentials and high-sensitivity material, may reach the selected AG model provider when AG opens them. Use them only under an explicit operator instruction that covers the local read scope and provider transfer; a standing instruction can cover future routine reads without per-file approval. Avoid unnecessary personal information in prompts and results. A configured AG read rule is technical access, not user authority. Project scope constrains controller arguments; Antigravity remains responsible for its sandbox and permissions.

An operator may opt into `read_file(*)` in the AG CLI's global `~/.gemini/antigravity-cli/settings.json` to permit reads of locally accessible files outside the active project. The rule applies to other AG CLI sessions too, not only this partner. Leave `allowNonWorkspaceAccess` at its existing setting: enabling it allowed an outside-project write in a synthetic edit-mode test, while `read_file(*)` alone allowed outside-project reads. Retain the sandbox and review any broader permissions separately. Neither the plugin nor its public defaults set this opt-in.

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
