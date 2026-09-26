# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Change the GitHub repository from private to public and align access, contribution and security guidance.

## 0.3.2 - 2026-09-26

- Record bounded controller, plugin and CLI version metadata on new runs, with a specific failure stage for invalid and failed outcomes. Older run records retain their original unknown provenance.
- Add a read-only `preflight` tool for observable model, AG MCP and review-packet state. It does not authenticate connectors, predict permission outcomes or create authority.
- Clarify the headless partner, desktop bridge, delegated result and Codex acceptance boundaries.

## 0.3.1 - 2026-09-22

- Prepare the private repo-local marketplace and collaborator documentation.
- Correct denied URL, command and unnamed-action classification so only denied file or directory reads become `permission_blocked`.
- Require an explicit prompt before creating an unattended grant.
- Add CI, dependency maintenance and portable relative-link checks.
- Preserve the pre-existing controller implementation as the inherited release baseline.
