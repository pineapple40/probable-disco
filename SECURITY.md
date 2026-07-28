# Security

This document describes the security posture of the local/development build. It is not a
certification of production-readiness — see the "Gaps and follow-ups" section for what a
professional security review should look at before any real deployment.

## Reporting a vulnerability

This is a local development project with no public deployment. If you find a security issue,
open an issue in the repository describing it; do not include real credentials or personal data
in the report.

## What's implemented

### Authentication & session management
- Passwords hashed with bcrypt (cost factor 12).
- Sessions are DB-backed opaque tokens (not JWTs): the raw token lives only in an `httpOnly`,
  `SameSite=Lax` cookie (`secure` in production); only a SHA-256 hash of it is stored server-side.
  This allows genuine server-side session revocation (logout, admin-forced deactivation,
  password reset all revoke sessions).
- Account lockout after 5 failed logins (15-minute lockout), tracked per-user in the database.
- Redis-backed fixed-window rate limiting on login, registration, and password-reset endpoints,
  independent of the per-account lockout.
- Optional TOTP multi-factor authentication (otplib), with hashed one-time recovery codes.
- A constant dummy-hash comparison runs even when the email doesn't exist, to reduce (not
  eliminate) timing-based account enumeration.

### Authorization
- Role-based (`trader` / `admin`) via a `Role` table with a `permissions` string array, not a
  hardcoded enum - additional roles can be added without a schema migration.
- Every admin API route calls `requireAdminUser()` server-side; the `/admin` page tree also
  redirects non-admins server-side before any admin UI renders.
- Every domain query filters by the authenticated user's own `userId`/`accountId` - there is no
  endpoint that accepts a raw foreign-user resource ID without an ownership check.

### Input validation & injection prevention
- All request bodies and query strings are validated with Zod schemas before use.
- All database access goes through Prisma's parameterized query builder - no raw string-built SQL
  anywhere in the codebase.
- React (JSX) escapes all rendered output by default; the only `dangerouslySetInnerHTML`-adjacent
  pattern in the app is none - no raw HTML injection points exist in the UI.

### Secrets
- Broker credentials are stored AES-256-GCM encrypted (`src/lib/crypto.ts`) and the schema field
  (`BrokerConnection.encryptedCredentials`) is never selected back out to a client-facing response
  anywhere in the codebase.
- Structured logs (Pino) redact `password`, `passwordHash`, `token`, `secret`,
  `encryptedCredentials`, and `authorization`/`cookie` headers at any nesting depth.
- `.env` is gitignored; `.env.example` contains no real secrets, only clearly-labeled dev-only
  placeholder values.

### Transport & headers
Set globally via `next.config.ts`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and a
Content-Security-Policy (`default-src 'self'`, no third-party script/style/connect origins).
`'unsafe-eval'` is added to `script-src` **only** in development (React dev-mode's debugging
features need it; production never does).

### CSRF
State-changing requests rely on `SameSite=Lax` cookies (blocks the cookie from being attached to
cross-site non-navigation requests) plus requiring `Content-Type: application/json`, which forces
a CORS preflight on cross-origin `fetch` that the app's implicit same-origin CORS policy then
blocks. There is **no separate CSRF token** implementation. This is a reasonable baseline for a
JSON API with no file-upload/simple-request endpoints, but a dedicated CSRF token (double-submit
cookie or per-form token) would be the more defense-in-depth choice before a public deployment.

### Audit logging
Every auth event (register, login success/failure, lockout, MFA changes, password reset), every
order (submit/fill/reject/cancel) and its risk decision, every strategy lifecycle change, and
every admin action is written to an append-only `AuditEvent` table, viewable by admins at
`/admin/audit`. Audit writes are best-effort (failures are logged but never block the underlying
action) and are not currently protected against a compromised database admin tampering with rows
directly - "tamper-resistant within the application's authorization model" means no application
code path lets a non-admin user modify or delete audit rows, not that the rows are cryptographically
sealed.

### Live trading is off by design
`FEATURE_LIVE_TRADING_ENABLED` defaults to `false`, `BrokerConnection.isLiveTradingReady` is
always `false`, and the admin feature-flags API explicitly rejects any attempt to flip the
`live_trading` flag to `true` - live trading requires a secure server-side configuration change
and acknowledgement flow that is intentionally **not implemented** in this release (see
docs/COMPLIANCE_CHECKLIST.md for what would need to exist first).

## Dependency vulnerabilities

`npm audit` reports advisories in nested dev-tooling dependencies (`postgs`/`sharp` vendored
inside `next`'s own dependency tree, `minimatch` inside `eslint-config-next`'s nested
`eslint-plugin-*` packages). The suggested fixes downgrade to much older, incompatible major
versions (e.g. `next@9.3.3`, `eslint@10.8.0` which breaks the toolchain - see ARCHITECTURE.md).
These are build-time tooling dependencies, not runtime code shipped to end users; they're
tracked here as a known, accepted risk pending upstream fixes, not silently ignored.

## Gaps and follow-ups for a professional review

- No dedicated CSRF token scheme (see above).
- No automated dependency/SAST scanning wired into CI yet (Dependabot/Snyk/CodeQL).
- No security-headers/CSP report-only rollout or reporting endpoint.
- Session fixation: session tokens are freshly generated on every login (not reused), but there
  is no explicit "regenerate on privilege change" step beyond that.
- No formal penetration test has been performed.
- Encryption key management (`CREDENTIALS_ENCRYPTION_KEY`) is a single static env var with no
  rotation procedure - see docs/DEPLOYMENT.md for what a real secret-rotation plan needs.
