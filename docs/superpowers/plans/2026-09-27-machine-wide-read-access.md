# Machine-wide AG Read Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let this operator's Claude and Gemini AG runs read every locally accessible file by default, while retaining existing write, command and sandbox controls.

**Architecture:** Put the opt-in read authority in the operator's global AG CLI settings, not the public plugin's defaults or the partner project's workspace allowlist. Update the partner's general guidance to recognise a separately authorised standing read policy. Validate behaviour with synthetic files through live headless runs before relying on private documents.

**Tech Stack:** AG CLI 1.2.12 settings JSON, Node.js 20+, existing MCP partner and Node test runner.

**Spec:** [Machine-wide read access design](../specs/2026-09-27-machine-wide-read-access-design.md)

## Global Constraints

- The operator approved `read_file(*)` for all files the local account can access, including finance, health, identity, work and credentials; actual file contents may reach the selected model provider.
- Keep `enableTerminalSandbox: true`, `toolPermission: proceed-in-sandbox` and the original `allowNonWorkspaceAccess` value; add no wildcard write, command, URL, MCP or unsandboxed grant.
- Keep project `allowed_paths`, edit permission, packet hashes, grant rules and separate approvals for consequential actions intact.
- Local AG settings, backups and synthetic canaries stay out of Git; the public plugin must not imply this opt-in applies to other users.
- Do not read or log real private content during verification. Do not publish, tag or push as part of this plan.

## Review Focus

- Existing `permissions.allow` entries or a pre-existing `read_file(*)`: preserve all entries and keep one wildcard rule; verify JSON before and after.
- Malformed settings, a symlinked settings file or unexpected file ownership: stop without overwriting; inspect metadata and report the blocker.
- `allowNonWorkspaceAccess: true` permits writing: leave the original unset value unchanged; the synthetic write probe must fail and the settings must be restored if it succeeds.
- A Claude or Gemini read is denied despite the rule: check the bounded denial and AG settings, then restore or revise; do not retry unchanged authority against private files.
- macOS privacy or filesystem denial: report that limit without claiming universal read success or widening other permissions.

---

### Task 1: Update the public partner guidance

**Files:**
- Modify: `plugins/codex-antigravity-partner/skills/codex-antigravity-partner/SKILL.md`
- Modify: `docs/governance-and-privacy.md`
- Modify: `plugins/codex-antigravity-partner/README.md`

**Interfaces:** No runtime interface changes. The skill consumes the operator's current, explicit standing access instruction and AG's configured capability; neither alone is treated as authorisation for other users.

- [ ] Replace the skill's per-file authorisation sentence with a rule that accepts an explicit standing read-and-provider-transfer instruction, while retaining exact approval for sends, edits, payments and other consequential actions. Add ordinary sandboxed path-based reading as the default route under that instruction; retain packets for immutable review evidence and retain broad unattended-approval restrictions.
- [ ] Update governance and package README to explain `read_file(*)`, its global CLI scope, selected-provider transfer, the separate `allowNonWorkspaceAccess` setting and the fact that project paths govern controller arguments rather than all AG reads. Do not include personal paths or claim the public plugin grants this permission.
- [ ] Run `node scripts/check-relative-links.mjs` from the repository root; expect `All relative links are valid.` Run `npm run check` from `plugins/codex-antigravity-partner`; expect all tests to pass.
- [ ] Review `git diff --check` and a content scan for private values, then commit the source documentation change. Leave installed plugin caches and public releases alone in this task.

### Task 2: Apply the operator's local AG read policy

**Files:**
- Modify locally, outside Git: `~/.gemini/antigravity-cli/settings.json`
- Create locally, outside Git: an owner-only, timestamped backup alongside the settings file

**Interfaces:** AG CLI consumes `permissions.allow` on subsequent runs; the partner requires no new API or project configuration field.

- [ ] Read only the settings structure and file metadata. Abort if JSON is malformed, the settings path is a symlink or ownership is unexpected. Record the existing `allowNonWorkspaceAccess`, `enableTerminalSandbox` and `toolPermission` values without printing other settings.
- [ ] Copy the original settings bytes to a timestamped, mode `0600` backup. Add exactly one `read_file(*)` entry to `permissions.allow`, preserving existing rules and keys, including `allowNonWorkspaceAccess`. Atomically replace the settings file with its prior owner and mode.
- [ ] Parse the saved JSON and assert one `read_file(*)`, unchanged pre-existing rules and `allowNonWorkspaceAccess`, `enableTerminalSandbox === true` and `toolPermission === 'proceed-in-sandbox'`. If any assertion fails, restore the backup before a live run.
- [ ] Create a synthetic canary outside the AG run's active project but inside the writable Antigravity workspace. Start a bounded plan-mode, sandboxed partner run with a currently available Claude model and another with a Gemini model; each must return the canary's exact synthetic value and reach `succeeded` without `read_permission_denied`.
- [ ] In a fresh synthetic sandboxed run, request a write to a separate out-of-workspace canary path. Confirm that no file was written and no broad write permission was granted. If a write succeeds, restore the original settings and report the failure; do not use the profile for private data.
- [ ] Keep the synthetic canary fixture for Task 3's post-install run. Retain the owner-only settings backup as the rollback artefact and record its path privately, without committing it.

### Task 3: Activate and verify the updated local plugin guidance

**Files:**
- Local installation source: `~/plugins/codex-antigravity-partner`
- Installed Codex plugin cache: managed by `codex plugin add`

**Interfaces:** The locally installed skill text must match the reviewed repository skill. Plugin MCP methods and package code remain byte-identical to the current installed v0.3.3 release.

- [ ] Inspect the existing local installation source and current cache version. Copy only the reviewed skill and documentation files from Task 1 into a backed-up local installation source; set its manifest to `0.3.3+codex.<UTCYYYYMMDDHHMMSS>` using the installation time, without changing the public release version.
- [ ] Run `codex plugin add codex-antigravity-partner@plugins-cli --json` to refresh the local installation. Verify the installed cache's skill bytes match the reviewed source and that the MCP server still handshakes successfully. Restore the prior local source/cache if installation fails.
- [ ] Check one fresh synthetic partner run after activation, inspect the run result and effective workspace, and report exactly what succeeded. Treat AG model token counts as AG metadata, not proof of Codex token savings.
- [ ] Remove only the synthetic fixture files created for these tests after the final run; retain the owner-only settings backup.
- [ ] Report the local settings backup and rollback method, the applied scope, and any macOS-protected paths that remain unverified. Keep source changes on the local branch for separate publication review.
