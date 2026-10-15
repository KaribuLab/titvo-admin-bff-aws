# Build the isolated Web Functions HTTP pilot

This pilot adds a Node HTTP transport around the existing BFF handler, without changing the production entrypoint, build command, or deployment. It targets **Node.js 24 on ARM64**, listens directly on `AWS_LAMBDA_HTTP_ENDPOINT`, and needs no Lambda Web Adapter. Preparing the bundle is not authorization to deploy it.

## Quick path: offline verification

Run from the repository root with the existing dependencies installed:

```sh
npx --no-install vitest run test/web-functions --maxWorkers=1 --minWorkers=1
npx --no-install rspack build -c rspack.web-functions.cjs
```

The artifact is `pilot-build/index.mjs`. The dedicated configuration copies the existing build rules and creates independent plugin instances; it does not mutate the production configuration. It relies on the installed Rspack builtin plugins' retained constructor arguments and fails closed for unsupported plugins. Its output is separate from `build/`, and the existing `npm run build` stays unchanged. Neither build is an AWS deployment.

## Runtime contract

| Setting | Behavior |
| --- | --- |
| `AWS_LAMBDA_HTTP_ENDPOINT` | Required in AWS; a bare `host:port`, such as `0.0.0.0:8080` (bracket IPv6 addresses). No scheme, path, or port zero. |
| Missing endpoint locally | Binds `127.0.0.1:3001` only when AWS Lambda runtime markers are absent. |
| `PORT` | Not used, including in AWS. |
| Startup | Validates the endpoint, imports the unchanged `src/entrypoint.ts`, initializes its Nest context, then listens. |
| Body limit | 1 MiB per request, counted in bytes; oversized requests return 413 without business dispatch. |
| Transport timeouts | 10-second header timeout, 30-second request-receipt timeout, 5-second idle keep-alive. These do not cancel business operations. |
| Shutdown | SIGTERM closes the listener and idle connections; remaining connections are closed after five seconds. |

Only after an operator has separately approved **isolated pilot-only dependencies** and configured the existing BFF environment for them, the runtime command is:

```sh
AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3001 node pilot-build/index.mjs
```

Do not run that entrypoint against production credentials, tables, secrets, or configuration. Importing the real entrypoint initializes application dependencies; the command is **not an offline smoke test**. No automatic seeding or AWS data mutation is authorized here. The HTTP tests use injected fake use cases and do not import the application entrypoint or call AWS.

## Deliberately restricted API

The allowlist is exact, method-sensitive, and checked before body parsing or business dispatch:

- `GET /api/admin/health`
- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/me`
- `GET /api/admin/config`

All other routes return `404 {"error":"not_found"}` with JSON content type. There is no `/v1` stage prefix removal, trailing-slash normalization, preflight bypass, or implicit HEAD route. Node suppresses response bodies for HEAD as required by HTTP. The production router itself is unchanged.

## Compatibility and failure behavior

The adapter creates an API Gateway v2-shaped event for each request: unchanged raw path/query, repeated query values joined with commas, lowercase HTTP headers, incoming cookies in both the cookie header and v2 cookies array, and HTTP request context. Request IDs and all event objects are request-local. The context passed by startup is a compatibility shim, not a Lambda invocation deadline; the existing handler does not depend on a real invocation context.

Text, JSON, and URL-encoded bodies use UTF-8; other content types use base64 with the v2 flag. Invalid UTF-8/JSON, non-object login JSON, or malformed target encoding returns `400 {"error":"invalid_request"}` without dispatch. JSON syntax validation does not replace existing application-field validation. Request byte overflow returns `413 {"error":"payload_too_large"}`. JSON validation errors do not echo payloads.

Structured handler responses preserve status, ordinary headers, binary base64 bodies, header-based `Set-Cookie`, and v2 `cookies` (combined without comma-folding). HTTP 204 responses have no body but retain cookies. Node owns framing, so handler-supplied content length and hop-by-hop transport headers are not forwarded. Invalid result types, statuses, cookies, headers, or base64 return `502 {"error":"invalid_response"}`. Thrown/rejected handlers return `500 {"error":"internal_error"}` without exception details. Existing handler logging is unchanged; this adapter never logs cookies, bodies, or handler errors.

The transport tests exercise real login/me/logout response handlers with fake use cases, simultaneous independent sessions, cookie clearing, route rejection, byte boundaries, malformed requests, binary responses, and recovery after errors. This establishes local transport behavior, not AWS runtime, origin signing, production auth, latency, or cost proof.

## Observed local integration smoke

The actual `pilot-build/index.mjs` bundle also passed **15 public HTTP checks**
against a dedicated LocalStack 3 container with fresh tables, secrets and a fake
admin. Business handlers were not mocked. Checks covered login/session/config
reads, unchanged Secure/HttpOnly/SameSite=Strict cookies, invalid input and
unsupported routes, logout, and rejection of the original cookie after logout.
The dedicated server/container were stopped after testing; no existing local
containers or production resources were changed. This was an API test, not a
browser or CloudFront test. Local logs remain ignored under
`pilot-build/local-smoke/`; no local credentials, datasets or binaries belong in
this branch.

For peer review, compare this branch from commit
`4a47fe49d51cfe1c359bb1afa7036afc013f8438`, the original
`feat/scan-execution-summary` branch point. Comparing directly with `main` also
includes the earlier scan-summary work. The transport and infrastructure are
separate work-unit commits; future deployment and any PR require separate
approval.

## Infrastructure seam and next step

See [the isolated infrastructure preparation](../pilot/web-functions/README.md) for provider pins, IAM-authenticated origin protection, pilot data isolation, and validation prerequisites. The infrastructure must package `pilot-build/index.mjs`, select Node24/ARM64, and preserve the runtime-provided `AWS_LAMBDA_HTTP_ENDPOINT`. The pilot has **no stage path**; do not add `/v1` in origin forwarding. CloudFront must forward cookies and the query string and must not cache authenticated responses. Local Terraform validation and four provider-mocked tests passed with the pinned providers; see the infrastructure guide for results and reproduction commands. Actual AWS startup, ARM64 runtime behavior, origin signing and browser authentication remain unverified. Any later activation requires a separate operator decision; there is no public-origin fallback or deployment permission here.
