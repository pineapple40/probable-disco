# Troubleshooting

## `npm install` fails or the app won't start

- **Node version**: this project needs Node.js ≥ 20.9 (check with `node -v`). If your global
  TypeScript/ESLint differ from what's pinned here, that's expected - see the "Why these
  choices" section in [ARCHITECTURE.md](../ARCHITECTURE.md) for why this repo pins
  `typescript@6.0.3` and `eslint@9.39.5` instead of their newest majors.
- **"Invalid environment configuration"** at boot: copy `.env.example` to `.env` - the app
  validates required env vars at startup (`src/lib/env.ts`) and fails fast with a clear list of
  what's missing, rather than crashing unpredictably later.

## Docker / database

- **`Cannot connect to the Docker daemon`**: start Docker Desktop (or `dockerd` if you're in a
  container-based environment without a running daemon). Then `npm run docker:up`.
- **Postgres/Redis containers show `Up (health: starting)` for a long time**: wait a few more
  seconds; `docker compose ps` should settle to `healthy`. If it doesn't, check
  `docker compose logs postgres` / `docker compose logs redis`.
- **`P1001: Can't reach database server`** from Prisma: confirm `DATABASE_URL` in `.env` matches
  the port Compose published (`POSTGRES_PORT`, default `5432`) and that the container is healthy.
- **Migration drift / "database schema is not in sync"**: for local dev, `npm run db:migrate`
  will offer to resolve it. Never run `prisma migrate reset` against data you want to keep - it
  drops everything.

## Login / auth

- **"Too many login attempts"**: the Redis-backed rate limiter (20 attempts / 5 minutes / IP)
  triggered - wait, or clear it manually: `docker exec probable-disco-redis redis-cli --scan
  --pattern "ratelimit:login:*"` to find the key, then `DEL` it.
- **Account locked after failed logins**: 5 failed attempts locks the account for 15 minutes
  (tracked on the `User` row, not Redis). Wait, or reset directly for local dev:
  ```sql
  update "User" set "failedLoginCount"=0, "lockedUntil"=NULL where email='you@example.com';
  ```
- **Verification/reset email never arrives**: no SMTP is configured by default - the email body
  (including the verification/reset link) is logged to the server console instead, prefixed
  `[DEV EMAIL]`. Look there.

## Orders always get rejected

Check the `riskDecision.ruleKey` in the API response (or the rejection reason shown in the order
ticket) - it names the exact rule that fired. Common ones during local testing:
- `stop_loss_required` — the default risk profile requires a stop-loss on every new entry; fill
  in "Stop-loss" on the order ticket.
- `market_closed` — the simulated market follows the real America/New_York trading calendar
  (weekdays, 09:30-16:00 ET); orders outside that window are rejected unless extended-hours
  trading is requested (which isn't supported in this release either, so it's rejected then too).
- `max_risk_per_trade_usd` / `max_risk_per_trade_pct` — your stop-loss is too far from the entry
  price relative to your position size; tighten the stop or reduce quantity.
- `cooldown_active` — you recently closed a losing position in that symbol; the default risk
  profile enforces a 15-minute cooldown before re-entering.

## Tests

- **Integration/e2e tests fail with a database error**: make sure `npm run docker:up` is running
  and `npm run db:migrate:deploy && npm run db:seed` have been applied.
- **E2E tests fail with "Too many login attempts"**: this shouldn't happen anymore - the e2e
  suite's `globalSetup` clears the login rate-limit bucket before running and logs in once,
  reusing that session across the trading spec. If you added a new spec file that logs in
  per-test instead of reusing `tests/e2e/.auth/demo.json`, that's the likely cause.
- **Playwright can't find a browser**: run `npx playwright install --with-deps chromium` once.
  (In this repo's local sandbox environment specifically, Chromium is pre-installed at a fixed
  path and `playwright.config.ts` detects and uses it automatically - see the comment there.)

## Worker

- **Strategies never fire**: the worker process (`npm run worker`) must be running separately
  from `npm run dev` - activating a strategy in the UI does not itself start any background
  evaluation. Check the worker's log output and the strategy's run log (visible on the
  Strategies page) for `error`-level entries.
- **A strategy run shows status `error`**: it auto-paused after 5 consecutive evaluation errors
  for one of its symbols (a safety measure, not a crash). Check its logs on the Strategies page,
  fix the underlying issue (e.g. an unknown symbol), then re-activate the strategy.
