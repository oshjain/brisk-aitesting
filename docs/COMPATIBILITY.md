# Compatibility

This page explains where `brisk-aitesting` works best today.

## Strong Fit Today

| Area | Current fit |
|:-----|:------------|
| Frontend apps | React, Next.js, Vite, Angular, Vue, Svelte, static HTML, and browser-rendered apps Playwright can open |
| Backend APIs | Any HTTP API reachable from the runtime |
| API contracts | OpenAPI 3.x JSON or YAML |
| UI testing | Browser flows through Playwright |
| API testing | HTTP request/response checks |
| Contract testing | OpenAPI parsing and response schema validation |
| AI providers | OpenAI-compatible chat-completions path plus custom provider interface |
| Runtime | Node.js 20 or newer |

## Best Results

Brisk works best when the app has:

- a running base URL
- stable UI labels, roles, text, or test IDs
- reachable HTTP APIs
- OpenAPI contracts
- safe test users or bearer tokens
- predictable test data

## Not Built In Yet

These require custom engines or future adapters:

- native mobile apps
- desktop apps
- binary protocols
- database-specific assertions
- queue and stream assertions
- Pact, AsyncAPI, Specmatic, or Keploy built-in adapters
- full performance testing
- full penetration testing

## Operating Systems

The package is designed for Windows, macOS, and Linux. The CI matrix should keep all three honest.

Browser execution also depends on Playwright browser installation in the host environment.

