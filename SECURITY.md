# Security Policy

## Reporting a vulnerability

Report security concerns privately to the repository owner through an existing trusted channel. Include the affected version, impact, reproduction steps and a minimal redacted example. Do not put credentials, private packets or exploitable details in a public issue.

## Security boundary

- The plugin invokes the installed `agy` executable and relies on its authentication and terminal sandbox.
- Project paths constrain controller arguments but are not an operating-system filesystem sandbox.
- Prompts are not persisted, but the current CLI receives them as process arguments.
- Credentials, identity evidence, raw high-sensitivity records, grants and private packets must not enter issues or logs.
- Edit permission, unattended review and publication retain separate approval boundaries.
- Private GitHub visibility is access control, not a substitute for secret scanning or data minimisation.

Only the current `main` branch is supported. See [governance and privacy](docs/governance-and-privacy.md) for the operating boundary.
