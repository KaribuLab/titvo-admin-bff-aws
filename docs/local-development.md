# Running titvo-admin-console locally

No real AWS account needed — this uses [LocalStack](https://localstack.cloud/)
for DynamoDB + Secrets Manager (the only two AWS services the BFF and
titvo-auth actually call at runtime).

Verified working end-to-end (BFF health check + SPA dev server both boot
cleanly) as of this writing; the LocalStack-backed data path (login, config
CRUD) has NOT been exercised yet — do that as your first local test.

## 1. Start LocalStack

```bash
cd titvo-admin-bff-aws
npm run local:up        # docker compose -f docker-compose.local.yml up -d
```

Requires Docker (or OrbStack/Colima etc.) running. Check it came up:
`docker compose -f docker-compose.local.yml ps`.

## 2. Configure and seed

```bash
cp .env.local.example .env.local   # adjust if you want, defaults are fine
npm install                        # if you haven't already
npm run local:seed                 # creates tables + secrets + one admin user
```

The seed script prints the admin email/password it created (defaults:
`admin@titvo.local` / `admin12345` — override via `LOCAL_ADMIN_EMAIL` /
`LOCAL_ADMIN_PASSWORD` env vars before running it). It's idempotent — re-run
any time, existing tables/secrets/the admin user are left alone.

## 3. Run the BFF

```bash
npm run dev   # vite-node src/local-server.ts, listens on :3001 by default
```

This is a **local-only** wrapper (`src/local-server.ts`) around the real
Lambda handler (`src/entrypoint.ts`) — a plain Node HTTP server that
translates real requests into the `APIGatewayProxyEventV2` shape the handler
expects. It's never bundled into the production Lambda build (`npm run
build` doesn't touch it).

Sanity check: `curl http://localhost:3001/api/admin/health` → `{"status":"ok"}`.

## 4. Run the SPA

```bash
cd ../titvo-admin-web
npm install   # if you haven't already
npm run dev   # Vite dev server, proxies /api/* to http://localhost:3001
```

Open the printed URL (usually http://localhost:5173). Log in with the admin
credentials from step 2.

## What you can actually test this way

- Login / logout / session expiry, `GET /api/admin/auth/me`.
- Config list (empty state, then populated).
- Add a secret / add a plaintext parameter, confirm the value is never
  echoed back.
- Update an existing key (explicit-update flow, 409 on type mismatch).
- `member`-role gating — seed a second user with `role: "member"` directly
  in DynamoDB (no UI to create one, this is intentionally out of scope, see
  the proposal's non-goals) and confirm write controls are hidden and the
  BFF returns 403 on a direct write.

## What you canNOT test this way

- CloudFront routing itself (this setup replaces it with Vite's dev proxy —
  functionally equivalent for `/api/*`, but not the same infrastructure).
- The actual Terragrunt/Terraform for either new component — no
  `terraform validate`/`plan` was run against them in any implementation
  batch (no AWS credentials in that environment). LocalStack does not
  validate the Terraform, only the application code paths.
- `titvo-installer seed-admin` (the real bootstrap path) — it has no
  LocalStack/`AWS_ENDPOINT` support, so local testing seeds the admin user
  directly via `scripts/local-seed.mjs` instead. If you want to test the
  real installer flow, that's a separate, real-AWS exercise (see
  `docs/admin-console-smoke-test.md` in titvo-installer).
- The existing `X-API-Key` CI/CD path (titvo-auth's original auth mechanism)
  — untouched by this change, not exercised by this local setup.

## Cleanup

```bash
cd titvo-admin-bff-aws
npm run local:down   # stops LocalStack; add -v to also wipe its volume
```
