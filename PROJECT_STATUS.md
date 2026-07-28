# Project Status

Last updated: 2026-07-28 (in-progress build session)

This file is the source of truth for what actually works today, what is
stubbed, and what remains. It is updated as work progresses, not just at
the end.

## How to run it

```bash
cp .env.example .env
npm install
npm run docker:up        # Postgres + Redis via Docker Compose
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Demo logins (created by `npm run db:seed`):
- Trader: `demo@probable-disco.local` / `Demo!Trader123`
- Admin: `admin@probable-disco.local` / `Demo!Admin123`

## Completed and verified

All items below were exercised against a real Postgres+Redis stack (not
just typechecked), either via curl against the dev server or via automated
tests.

- **Project scaffold**: Next.js 16 (App Router) + TypeScript strict mode,
  Tailwind v4, ESLint 9 flat config, Prettier, Docker Compose for
  Postgres 16 + Redis 7, production Dockerfile (multi-stage, standalone
  output), `.env.example` with no required secrets.
- **Database**: Full Prisma schema (see `prisma/schema.prisma`) covering
  users/roles/sessions/MFA, broker & market-data connections, accounts,
  instruments/quotes/candles, watchlists, orders/executions/positions,
  risk profiles/events, strategies/versions/runs, backtests, alerts/
  notifications, journal/attachments/tags, scanner presets, audit events,
  settings, and feature flags. Initial migration applied and seed script
  populates a realistic instrument universe plus demo accounts.
- **Auth**: Registration, DB-backed sessions (creation/revocation/cookie),
  login with account lockout after 5 failed attempts, Redis-backed per-IP
  rate limiting, email verification and password reset (emails logged to
  console since no SMTP is configured by default - see `sendEmail`),
  optional TOTP MFA with recovery codes, full audit logging of
  auth/security events. Role-based authorization via a `Role` table
  (trader/admin) designed so more roles can be added without a schema
  change.
- **Market data**: Provider-neutral `MarketDataProvider` interface with a
  deterministic simulated implementation (seeded random walk, reproducible
  across restarts - important for backtesting). Daily candles are cached
  in Postgres; intraday candles (M1/M5/M15/H1) are generated as a
  Brownian bridge anchored to the cached daily candle, bounded to a
  30-day window. Live quotes are computed on demand (not persisted
  per-tick, to avoid unbounded row growth) and reflect real
  America/New_York market-session state (DST-aware). REST endpoints for
  quote/candles/instrument search plus an SSE stream for live quotes.
- **Simulated broker + accounting**: `BrokerAdapter` interface with a
  simulated implementation. MARKET orders fill immediately with small
  simulated slippage; LIMIT/STOP/STOP_LIMIT orders rest until a matching
  pass sees a triggering quote. Idempotency keys prevent duplicate
  submissions from creating duplicate orders. Portfolio accounting is
  **long-only for v1** (oversized sells are rejected as short-selling,
  matching the documented scope restriction), updates cash/position/
  realized P&L atomically, and recomputes equity from live quotes.
- **Risk engine**: Pure, DB-free rule evaluator (`src/server/risk/engine.ts`)
  fed by a context assembled from the database
  (`src/server/risk/context.ts`). Enforces: emergency lock, market-hours-
  only trading, max spread, daily/weekly loss lockout, consecutive-loss
  pause, post-stop cooldown, no-short-selling, max open positions/symbol
  exposure/gross exposure/position size/order notional, buying power,
  required stop-loss, max risk per trade ($ and %), and minimum
  reward-to-risk ratio. Every decision (allowed or rejected) is persisted
  as a `RiskEvent` tied to the order and to the audit log.

Verified manually end-to-end: register → login → place order rejected for
missing stop-loss → place valid order → fills → position/cash/equity
update correctly → limit order rests → cancel → oversized sell rejected →
closing sell realizes correct P&L.

## In progress / not yet built

- Dashboard, watchlist, chart, scanner, and order-ticket UI (beyond the
  bare-bones dashboard placeholder page) - next up.
- Journal and analytics UI.
- Strategy builder UI and the rule evaluation engine.
- Backtesting engine.
- Paper strategy runner / background worker (BullMQ is installed but no
  worker process exists yet).
- Alerts and notifications (schema exists; no rule evaluation or delivery
  yet).
- Admin UI (user/feature-flag/audit-log management).
- Automated test suite (Vitest unit tests, Playwright e2e) and CI workflow.
- ARCHITECTURE.md, SECURITY.md, CONTRIBUTING.md, docs/THREAT_MODEL.md,
  docs/COMPLIANCE_CHECKLIST.md.

## Key assumptions and design decisions

- **Single account per user** in v1 (the seed/registration flow creates
  exactly one paper `Account` per user). Multi-account support would be a
  straightforward schema-compatible extension later.
- **Auth is custom-built**, not next-auth: DB-backed sessions were needed
  for user-controlled revocation, which doesn't fit next-auth's
  credentials-provider model cleanly.
- **CSRF**: relies on `SameSite=Lax` session cookies plus requiring
  `Content-Type: application/json` on state-changing requests (blocks
  simple cross-origin form submission and triggers a CORS preflight for
  cross-origin fetch, which same-origin-only CORS config then blocks). No
  separate CSRF token scheme was implemented. Documented for review in
  SECURITY.md (pending).
- **Decimal arithmetic** in portfolio/risk code uses JS `number`, not an
  arbitrary-precision decimal library, after converting Prisma `Decimal`
  values via `Number()`. Acceptable for simulated paper trading; would
  need revisiting (e.g. decimal.js throughout) before ever touching real
  money.
- **Market holiday calendar is not modeled** - every Monday-Friday is
  treated as a trading day. Only the US equity regular session
  (09:30-16:00 America/New_York) is modeled; extended hours are not
  supported (orders flagged `isExtendedHours` are rejected while the
  market is closed).
- **STOP_LIMIT orders** are simplified: the stop and limit conditions are
  evaluated together on each matching pass rather than modeling a
  persistent "triggered" sub-state. This can miss some real-world
  scenarios where a stop triggers but the limit isn't immediately
  satisfiable; documented as a known limitation.
- **No partial fills are simulated** - the matching engine always fills an
  order's entire remaining quantity at once. The schema supports partial
  fills (`filledQuantity`, `PARTIALLY_FILLED`) for when this is added.
  Currently only relevant if a future change models order-book depth.
- **Buying power** uses a flat 2x cash multiplier (a simplified reg-T-like
  model). Real margin/maintenance-requirement calculations are explicitly
  out of scope per the product brief.
- **TypeScript/ESLint versions**: pinned to TypeScript 6.0.3 and ESLint
  9.39.5 rather than the newest published majors (TypeScript 7.0.2, ESLint
  10.8.0) because `typescript-eslint` (used by `eslint-config-next`)
  does not yet support either — confirmed by hard runtime failures, not
  guesswork. Re-evaluate once typescript-eslint ships support (tracked
  upstream: https://github.com/typescript-eslint/typescript-eslint/issues/10940).
- **Prisma 7 requires an explicit driver adapter** (`@prisma/adapter-pg`)
  at runtime; both `src/lib/db.ts` and `prisma/seed.ts` construct one from
  `DATABASE_URL`.

## Known limitations / follow-ups for a professional review

- No automated tests exist yet for the risk engine, order state machine,
  or indicator math - this is the single highest-priority gap before
  calling the risk/order path "trustworthy."
- No CI pipeline yet.
- Live-trading is fully gated off (`FEATURE_LIVE_TRADING_ENABLED=false`,
  `BrokerConnection.isLiveTradingReady` always `false`) but the
  acknowledgement flow described in the product brief has not been built
  yet - live trading cannot be enabled at all right now, by design.
- Threat model and compliance checklist docs are not yet written.
