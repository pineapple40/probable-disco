# Threat Model

Scope: the local paper-trading platform as it exists today (simulated market data, simulated
broker, no real money, no real brokerage connections). This is a working threat model for a
development-stage product, not a certified assessment.

## Assets

1. User credentials (password hashes, MFA secrets/recovery codes, session tokens).
2. Broker connection credentials (encrypted at rest; currently only the simulated provider is
   wired up, but the field/encryption exists for a future real paper-broker connection).
3. Trading data: orders, positions, journal entries, strategies, backtests - not financially
   valuable directly (paper money), but sensitive as personal trading behavior/strategy data.
4. Audit log integrity - the record of who did what.
5. Application availability (the ability to place/cancel orders, see quotes).

## Actors

| Actor | Motivation | Capability |
| --- | --- | --- |
| Anonymous internet attacker | Credential theft, account takeover, defacement | Network access to the app only |
| Authenticated trader (malicious or compromised account) | Access another user's data, escalate privileges, evade risk controls | Valid session, in-app actions only |
| Malicious/compromised admin | Broad data access, disable risk controls, alter audit trail | Full admin UI/API access |
| Insider with database access | Direct data exfiltration/tampering | Direct DB access (bypasses the app entirely) |
| Automated bot / credential-stuffing | Account takeover at scale | Scripted login attempts |

## STRIDE-style walkthrough

### Spoofing
- **Session token theft (XSS, network sniffing)** → mitigated by `httpOnly` cookies (not
  readable by JS), CSP restricting script sources, and requiring HTTPS in production (`secure`
  cookie flag when `NODE_ENV=production`). *Residual risk*: no HSTS header is currently set by
  the app itself (should be set at the reverse-proxy/TLS-termination layer in deployment - see
  docs/DEPLOYMENT.md).
- **Credential stuffing / brute force** → mitigated by per-account lockout (5 attempts) and
  Redis-backed per-IP rate limiting on login. *Residual risk*: the rate limit is a shared bucket
  keyed by IP; a distributed attack from many IPs isn't slowed by this alone - would need a
  WAF/CAPTCHA layer in a real deployment.

### Tampering
- **Order/position data tampering** → all writes go through the service layer with ownership
  checks (`accountId`/`userId` scoping); no endpoint accepts a client-supplied account ID it
  doesn't already own. Prisma's parameterized queries prevent SQL injection.
- **Audit log tampering by a non-admin** → no application code path allows editing or deleting
  `AuditEvent` rows. *Residual risk*: an admin (or anyone with direct DB access) can still modify
  audit rows directly - see SECURITY.md's tamper-resistance caveat.
- **Risk-decision bypass** → the risk engine runs server-side, immediately before order
  execution, on every order path (manual and strategy-runner-originated); there is no client-side
  gate that alone could be bypassed to skip a check.

### Repudiation
- Every auth event, order, risk decision, and admin action is written to `AuditEvent` with a
  timestamp, actor (when known), and IP address, viewable by admins.

### Information Disclosure
- **Broker credentials** are AES-256-GCM encrypted at rest and never returned in any API
  response (checked: no route selects `encryptedCredentials` into a client-facing payload).
- **Cross-user data leakage** → every list/detail query filters by the authenticated user's ID;
  no insecure direct object reference (IDOR) pattern exists where a resource ID alone (without an
  ownership check) grants access.
- **Logs** redact secrets/tokens/passwords (see SECURITY.md).
- *Residual risk*: error messages returned to the client are generally safe (validation errors,
  business-rule messages) but haven't been exhaustively audited for stack-trace leakage in every
  unhandled-exception path; Next.js's default production error handling suppresses stack traces
  from the client, which covers the common case.

### Denial of Service
- Redis-backed rate limiting on auth endpoints reduces (not eliminates) credential-stuffing load.
- No general API rate limiting exists on trading endpoints yet (e.g. rapid order submission) -
  the idempotency-key mechanism prevents *duplicate* orders but doesn't cap request *rate*.
  A production deployment should add a reverse-proxy/WAF rate limit in front of `/api/orders`.
- The paper strategy runner and alert evaluator isolate per-symbol/per-alert failures (a broken
  strategy or alert can't take down the whole tick), and a strategy run auto-pauses after 5
  consecutive errors rather than looping forever.

### Elevation of Privilege
- Role is stored server-side (`Role` table via `roleId`), never trusted from client input; every
  admin-only route re-checks the caller's role server-side (`requireAdminUser()`), not just at
  the page/layout level.
- An admin cannot deactivate their own account via the admin API (prevents accidental full
  lockout), but *can* demote/promote any account including their own role - a real deployment
  should consider requiring a second admin for self-demotion/demotion of the last remaining admin.

## Explicitly out of scope for this threat model

- Real brokerage integration (not implemented - see PROJECT_STATUS.md).
- Real-money custody, KYC/AML, PCI (no payment processing exists in this app).
- Physical security, cloud-provider infrastructure security (deployment-specific, not
  application-specific).

## Priority follow-ups before any real-money-adjacent deployment

1. Add a dedicated CSRF token scheme rather than relying solely on `SameSite=Lax` + JSON
   content-type.
2. Add API-level rate limiting on trading endpoints, not just auth.
3. Wire up dependency/SAST scanning in CI.
4. Formal secret rotation procedure for `CREDENTIALS_ENCRYPTION_KEY` and `SESSION_SECRET`.
5. Third-party penetration test.
