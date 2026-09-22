# Troubleshooting

Start with `agy models` and `agy --help` to confirm the CLI is installed and authenticated, then call `capabilities` to confirm the controller sees the expected models.

## MCP Tools Issues

If the MCP server does not start, use Node.js 20 or later, run `npm ci`, and confirm `.mcp.json` points to `node ./server.mjs` with the plugin as its working directory.

Configuration failures occur before a child process starts. Check that the workspace and added directories resolve within `allowed_paths`, the requested permission is allowed, and the selected model appears in `capabilities`.

## Run Failures

- `invalid_result`: the CLI returned empty, narrative-only or schema-invalid output. Do not infer completion from exit code zero.
- `permission_blocked`: AG reported a denied file or directory read on a failed or invalid result. Change the packet or authority; changing only the prompt or model is not enough.
- `failed`: inspect the bounded controller error and denied actions.
- `timed_out`: reduce the task or increase the project limit within policy.
- `orphaned`: the prior controller is gone; inspect external effects before starting replacement work.
- `cancelled`: the controller terminated the owned process group.

For review work, confirm the manifest still verifies, the packet configuration is exact, the project permits unattended review, and any supplied grant is fresh and bound to the same manifest, model and sandbox permission.

## Testing Failures

Run from `plugins/codex-antigravity-partner`:

```bash
npm ci
npm run check
```

The tests inject `test/fixtures/fake-agy.mjs` and must never call the live service. Authentication errors during tests indicate the fake path was not used.

For exact state and trust semantics, use the [MVP contract](../plugins/codex-antigravity-partner/docs/mvp-contract.md).
