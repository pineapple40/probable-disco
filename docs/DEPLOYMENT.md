# Deployment

This describes how to prepare the app for deployment. **No production deployment has been
performed or should be performed without explicit approval and budget sign-off.**

## What's already in place

- A multi-stage `Dockerfile` producing a Next.js `standalone` build, running as a non-root user,
  with a `HEALTHCHECK` against `GET /api/health`.
- `GET /api/health` (liveness) and `GET /api/ready` (readiness - checks Postgres and Redis are
  reachable).
- Environment-variable validation at boot (`src/lib/env.ts`) - the app refuses to start with a
  missing/invalid required variable rather than failing unpredictably later.
- Structured JSON logging (Pino) with secret redaction, suitable for shipping to a log
  aggregator.
- Database migrations are tracked in `prisma/migrations/` and applied via `prisma migrate deploy`
  (safe for production - unlike `migrate dev`, it never resets data or prompts interactively).

## Environment separation

The app reads `NODE_ENV` and `APP_ENV` (see `.env.example`). Use separate `.env` files (or
separate secret-manager entries) per environment:

| Environment | Notes |
| --- | --- |
| development | `.env`, docker-compose Postgres/Redis, seeded demo data |
| test | Used by CI; ephemeral Postgres/Redis service containers, seeded fresh each run |
| staging | Should mirror production configuration but with its own database/Redis and non-production secrets |
| production | Real secrets from a secret manager (never committed), `NODE_ENV=production` |

## Building and running the container

```bash
docker build -t probable-disco .
docker run -p 3000:3000 --env-file .env.production probable-disco
```

The container needs network access to a Postgres instance (`DATABASE_URL`) and a Redis instance
(`REDIS_URL`) - it does not bundle either. Run migrations as a separate step before starting new
containers, not as part of container startup (avoids multiple replicas racing to migrate):

```bash
docker run --rm --env-file .env.production probable-disco npx prisma migrate deploy
```

## Statelessness

The application container itself is stateless - all state lives in Postgres and Redis - so it's
safe to run multiple replicas behind a load balancer. Two things to be aware of if you do:

- The background worker (`npm run worker`) should run as a **single replica** (or with leader
  election) - running it multiple times would cause the strategy runner and alert evaluator to
  double-tick, which is otherwise guarded against by idempotency keys but wastes work.
- Redis-backed rate limiting is shared across all app replicas correctly (keyed in Redis, not
  in-process memory).

## Database

- **Backups**: not configured by this repo - use your Postgres host's native backup/PITR
  functionality (e.g. managed Postgres snapshots). Test restores periodically.
- **Migrations**: `npx prisma migrate deploy` in a pre-deploy step. Review each migration's SQL
  before applying to production (`prisma/migrations/<timestamp>_<name>/migration.sql`) -
  especially for `NOT NULL` additions or column drops on tables with data.
- **Rollback**: Prisma does not auto-generate down-migrations. For a schema change that needs to
  be rolled back, write and test the reverse migration explicitly before deploying the forward
  one, or restore from a pre-deploy backup.
- **Retention**: `Candle` data grows with usage (see PROJECT_STATUS.md) - there is no automatic
  pruning job yet. Before a long-running production deployment, add one (e.g. a scheduled job
  deleting `Candle` rows past a retention window), since the schema intentionally does not
  auto-partition or auto-expire this table today.

## Secrets

- Never commit `.env`. `.env.example` documents every variable with safe placeholder values.
- `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` must be real random values in any non-local
  environment (`openssl rand -base64 48` / `openssl rand -base64 32`) - see the comments in
  `.env.example`.
- Rotate `CREDENTIALS_ENCRYPTION_KEY` by re-encrypting all `BrokerConnection.encryptedCredentials`
  rows with the new key in a maintenance script before switching the env var - there is no
  built-in dual-key rotation support today.

## TLS

The application itself does not terminate TLS. Deploy behind a reverse proxy or platform load
balancer that terminates HTTPS and forwards to the app over the internal network; set
`Strict-Transport-Security` at that layer (not currently set by the app itself - see
docs/THREAT_MODEL.md).

## Monitoring / error reporting

- `LOG_LEVEL` and Pino's JSON output are ready to ship to any log aggregator that ingests
  structured JSON (Datadog, CloudWatch, Loki, etc.).
- `ERROR_REPORTING_DSN` is reserved in `.env.example` but no error-reporting SDK (e.g. Sentry) is
  wired up yet - this is a hook point, not a working integration.
- `GET /api/ready` is suitable for a load balancer's health check and for external uptime
  monitoring.

## Feature flags

`FeatureFlag` rows in the database (managed at `/admin/feature-flags`) gate `mfa` and `signup`.
`live_trading` is present but cannot be enabled through the admin UI by design (see
SECURITY.md and docs/COMPLIANCE_CHECKLIST.md) - enabling real trading requires a code change and
a compliance sign-off, not a database toggle.

## Incident response (starting checklist)

1. Use `GET /api/ready` and the admin audit log to establish what happened and when.
2. If trading needs to stop immediately for one account: the account owner can trigger it from
   the dashboard ("Emergency stop trading"), or an operator can call
   `POST /api/accounts/emergency-lock` directly (requires that user's session) or update
   `EmergencyTradingLock.isLocked` in the database for an account whose owner is unreachable.
   A dedicated admin-initiated lock (locking *any* account, not just your own) is a good
   near-term addition (see PROJECT_STATUS.md).
3. If the paper strategy runner is misbehaving broadly: stop the `npm run worker` process - all
   manual trading continues to work independently since it doesn't depend on the worker.
4. Roll back by redeploying the previous container image; only roll back a database migration if
   you've verified/tested the reverse migration (see "Rollback" above).
