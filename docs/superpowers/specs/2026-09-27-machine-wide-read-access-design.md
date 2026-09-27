# Machine-wide read access for AG delegation

## Decision and intent

The operator wants Codex to delegate more document work to Claude and Gemini through Antigravity (AG) so Codex spends fewer tokens reading and summarising files. The approved scope is every file the local account can read on this machine, including private finance, health, identity, work and credential material. An AG model may receive the contents of a file it opens. This is an explicit opt-in for this operator, not a default for other plugin installations.

Success means a headless AG run started by the partner can read a named file outside its current project without an interactive permission prompt, while the existing sandbox and command policy stay in force. A file read alone must not grant file writes, unsandboxed commands, connector actions or sends to third parties beyond the selected model provider. macOS privacy protections and ordinary filesystem permissions still apply.

## Approaches considered

1. **Machine-wide AG read rule (selected).** Add `read_file(*)` to the operator's AG CLI `permissions.allow` list. This directly matches the requested scope and applies to both Claude and Gemini headless runs. It is global to the AG CLI profile, including runs outside the Codex partner.
2. **Named document roots.** Grant recursive reads to selected folders. This limits exposure but fails the operator's stated requirement to read all files, including future folders elsewhere on the machine.
3. **Broad per-run auto-approval.** Use `--dangerously-skip-permissions` or a full-machine workspace. These also relax write and command controls and therefore exceed the approved read scope.

## Configuration and data flow

The local AG CLI settings file, `~/.gemini/antigravity-cli/settings.json`, is the permission authority. Preserve its existing keys and add only the `read_file(*)` allow rule. Leave `allowNonWorkspaceAccess` at its existing value. A synthetic run confirmed that the explicit read rule alone permits an outside-project read; setting `allowNonWorkspaceAccess: true` also permitted an outside-project write in edit mode and was rolled back. Preserve `enableTerminalSandbox: true` and the current `toolPermission: proceed-in-sandbox`. Do not add `write_file(*)`, `command(*)`, `unsandboxed(*)`, `mcp(*)` or `read_url(*)` rules.

The partner's `.agent-collab/project.yaml` continues to control the working directory, `--add-dir` arguments, edit mode and model allowlist. Do not change its `allowed_paths` to `/`: AG auto-allows writes in an active workspace, and the partner's path list is not a filesystem sandbox. AG's own global read rule supplies the additional read access. The partner continues to pass `--sandbox` and plan mode for read tasks.

Codex gives AG a file path and bounded task, not a pasted copy of the file. AG reads it under its permission rule and may send the content to the selected provider. The partner stores delegated results and bounded run metadata as it does today; instructions should avoid unnecessary verbatim private content in prompts and results. Existing review packets remain available when immutable source copies and manifest-bound attestations are useful, but routine private-document reading does not require a packet merely to obtain permission.

## Partner guidance and public distribution

Update the partner skill and privacy documentation to distinguish an operator's standing, explicit machine-read authorisation from the plugin's default policy. The published plugin must not assert that every user has authorised private-data transfer. It should explain that a configured AG read rule is a technical capability, while the operator's instruction supplies the authority to use it. Model choice, result verification and separate approval for consequential actions continue to apply.

The existing unattended-review grant path is not used for ordinary reads. No change to the review packet's manifest binding, hash validation or single-use grant semantics is part of this work.

## Failure handling and revocation

Make an owner-readable backup of the original AG settings before editing and write the new JSON atomically. If the CLI rejects the setting, the target file remains inaccessible, or a read test requires a wider permission than described here, restore the original settings and report the precise block. A permission denial is not a reason to retry the same run unchanged.

The operator can revoke machine-wide AG read access by removing `read_file(*)` and restoring the prior `allowNonWorkspaceAccess` value from the backup. Revocation affects future AG runs; it cannot retract content already sent to a provider or present in completed run records.

## Verification

1. Validate the settings JSON and confirm the existing sandbox and command policy values remain unchanged.
2. Create a synthetic, non-sensitive canary file outside the active AG project. Run one Claude and one Gemini headless read through the partner; each must return the canary value without a read permission denial. Do not use actual private documents in this test.
3. Check that the partner's recorded effective workspace and added paths remain project-scoped. Run a synthetic out-of-workspace write probe and confirm it cannot write without a separate grant. If it can, restore the settings and revise this design before using the profile on private data.
4. Run the repository's existing checks for any skill or documentation change. Inspect the final diff for local paths, private data and settings backups before any public commit or release.

## Limits

`read_file(*)` covers files AG can reach under the local account; it does not bypass macOS privacy prompts, encrypted volumes or filesystem permissions. It applies globally to the AG CLI profile, not solely to Codex partner runs. The desktop AG application's project permission settings may be separate and are outside this change. AG-reported success and source claims still need independent review for material decisions. Reduced Codex token use is the intended outcome, not a guaranteed measured saving; compare comparable delegated tasks after rollout.

## Primary references

- [AG permissions](https://antigravity.google/docs/permissions?tab=cli): global CLI rules, wildcard matching and read-only sandbox mounts.
- [AG headless mode](https://antigravity.google/docs/cli/headless/): soft denial of unapproved tools and the scope of broad auto-approval.
- [AG settings](https://antigravity.google/docs/settings?tab=cli): non-workspace access, sandbox and tool permission settings.
