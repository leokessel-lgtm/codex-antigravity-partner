# AG Partner Observability Implementation Plan

> **For agentic workers:** Implement this plan in the current isolated worktree, using test-first cycles for behaviour changes.

**Goal:** Upgrade the installed AG partner from its 0.3.0 baseline and make future failures and connector prerequisites easier to assess without weakening permissions.

**Architecture:** Keep AG execution and approvals in the existing controller. Add bounded, non-sensitive run metadata and a read-only preflight that reports only facts returned by the local AG CLI and the existing packet verifier. JEV evaluates implementation findings outside the runtime path and never selects a model or grants authority automatically.

**Tech stack:** Node.js 20+, MCP SDK, `agy` CLI, Node test runner.

**Spec:** The revised plan in the current task and `plugins/codex-antigravity-partner/docs/mvp-contract.md`.

## Global constraints

- No prompt, raw stdout/stderr, credential or private evidence in durable run state.
- Existing run records remain readable without invented version backfills.
- Preflight never tests connector authentication, predicts AG permission decisions, creates grants or starts a run.
- Keep manifest-bound review, explicit model choice and single-use grant rules intact.

## Review focus

- Old run files lack the new fields and must still load.
- Malformed outer JSON and malformed nested results need different failure stages.
- A denied file read can accompany malformed structured output; retain both facts.
- Missing or malformed MCP inventory must be reported as unknown, not available.
- A disabled connector must not be reported as authenticated or usable.

## Tasks

### 1. Install and verify the newer baseline

- [x] Confirm the current installed version and source hash, then install the tested 0.3.2 package, which includes the 0.3.1 denial classification fix.
- [x] Verify a fresh MCP handshake and bounded sandboxed structured run. Keep the previous cache for rollback.

### 2. Add versioned, bounded failure diagnostics

- [x] Write failing tests for run provenance, failure stages and old-state reads.
- [x] Add metadata and stage reporting in `src/runner.mjs`, without changing terminal state semantics.
- [x] Run the focused tests and the complete package check.

### 3. Add observational connector preflight

- [x] Write failing tests for enabled, disabled, missing and unknown AG MCP inventory; model and packet checks.
- [x] Add a read-only `preflight` MCP tool and implementation with no connector invocation or permission prediction.
- [x] Run the focused tests and the complete package check.

### 4. Document, evaluate and install

- [x] Document route selection and the difference between started, validated AG result, adjudication and acceptance.
- [x] Use JEV for bounded evaluation of one interface finding using public state only, then independently adjudicate.
- [x] Bump the plugin version, verify installed bytes and fresh MCP handshake, and run one bounded live structured smoke test.
- [x] Record the live result and rollback route; do not publish or push without separate authority.

**Ruling:** Install the tested 0.3.2 package directly because it includes the 0.3.1 fix and avoids two live replacement operations. If that integration assumption were wrong, rollback is to the retained 0.3.0 package and source diff.

**Verification:** Source suite 63/63; installed suite 62 passed and one repository-only test skipped; installed package source files 37/37 byte identical to the worktree; fresh MCP handshake reported controller 0.3.2; live sandboxed synthetic AG run succeeded with a schema-valid result and version metadata. JEV's Choice request failed validation; the separately authorised Boolean evaluation returned 0.83 probability in favour of renaming the configuration field. Codex independently accepted that narrower wording.
