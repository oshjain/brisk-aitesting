# Security

`brisk-aitesting` is designed to run inside the user's environment.

It does not require a hosted platform, a hosted database, or a remote dashboard.

## Core Rules

- AI output is never executed directly.
- AI must return a structured plan.
- The plan is normalized and validated before execution.
- Engines do execution.
- Results are written as local artifacts.
- Secrets are redacted by default.
- Network access is controlled by config.

## Network Policy

| Policy | Meaning |
|:-------|:--------|
| `localhost-only` | Only localhost, 127.0.0.1, and ::1 |
| `allowlist` | Only configured hosts |
| `open` | Any host reachable by the runtime |

Use `allowlist` for staging or controlled enterprise environments.

## Secret Handling

Set this unless you have a special reason not to:

```ts
security: {
  redactSecrets: true,
}
```

Brisk redacts common secret-looking keys and values in artifacts and plugin checks.

## AI Provider Boundary

AI providers receive prompts containing the goal and summarized discovery context.

They do not receive permission to run shell commands. They do not write executable code that Brisk runs blindly.

For enterprise use, route AI calls through your approved provider, gateway, proxy, or local model endpoint.

## Artifacts

Artifacts can include:

- request/response evidence
- browser traces
- screenshots
- logs
- generated test files
- result JSON

Do not publish artifacts from sensitive environments without reviewing your own data rules.

## Recommended Production Posture

- use `allowlist`
- keep `redactSecrets: true`
- use short-lived test credentials
- run against safe test data
- store artifacts in a controlled location
- use a corporate AI gateway if source or route metadata is sensitive

