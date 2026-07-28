# Project Status

Last updated: 2026-07-28

This file is the source of truth for what actually works today, what is simplified, and what
remains. Everything marked "done" below has been exercised for real — against the actual
Postgres/Redis stack, via automated tests, and/or via a real headless-browser session — not just
typechecked.

## How to run it

```bash
cp .env.example .env
npm install
npm run docker:up        # Postgres + Redis via Docker Compose
npm run db:migrate:deploy
npm run db:seed
npm run dev               # http://localhost:3000
npm run worker            # optional, separate process: paper strategy runner + alerts
```

Demo logins (created by `npm run db:seed`):
- Trader: `demo@probable-disco.local` / `Demo!Trader123`
- Admin: `admin@probable-disco.local` / `Demo!Admin123`

## Completed and verified

- **Project scaffold**: Next.js 16 (App Router) + TypeScript strict mode, Tailwind v4, ESLint 9
  flat config, Prettier, Docker Compose for Postgres 16 + Redis 7, production Dockerfile
  (multi-stage, standalone output, non-root user, healthcheck), `/api/health` +`/api/ready`,
  `.env.example` with no required secrets.
- **Database**: full Prisma schema covering users/roles/sessions/MFA, broker & market-data
  connections, accounts, instruments/quotes/candles, watchlists, orders/executions/positions,
  risk profiles/events, strategies/versions/runs/logs, backtests/backtest trades, alerts/
  notifications, journal/attachments/tags, scanner presets, audit events, settings, and feature
  flags. Migration applied, seed script populates a realistic instrument universe and demo
  accounts.
- **Auth**: registration, DB-backed sessions (creation/revocation/cookie), login with account
  lockout after 5 failed attempts, Redis-backed per-IP rate limiting, email verification and
  password reset (emails logged to console since no SMTP is configured by default), optional
  TOTP MFA with recovery codes, full audit logging. Role-based authorization via a `Role` table
  (trader/admin), designed so more roles can be added without a schema change.
- **Market data**: provider-neutral `MarketDataProvider` interface with a deterministic simulated
  implementation (seeded random walk, reproducible across restarts). Daily candles cached in
  Postgres; intraday candles (M1/M5/M15/H1) generated as a Brownian bridge anchored to the cached
  daily candle, bounded to a 30-day window. Live quotes computed on demand (no per-tick
  persistence) and reflect real America/New_York market-session state (DST-aware). REST endpoints
  for quote/candles/instrument search, plus an SSE stream for live quotes.
- **Simulated broker + accounting**: `BrokerAdapter` interface with a simulated implementation.
  MARKET orders fill immediately with small simulated slippage; LIMIT/STOP/STOP_LIMIT orders rest
  until a matching pass sees a triggering quote. Idempotency keys prevent duplicate submissions.
  Portfolio accounting is **long-only for v1**, updates cash/position/realized P&L atomically, and
  recomputes equity from live quotes.
- **Risk engine**: a pure, DB-free rule evaluator fed by a context assembled from the database.
  Enforces emergency lock, market-hours-only trading, max spread, daily/weekly loss lockout,
  consecutive-loss pause, post-stop cooldown, no-short-selling, max open positions/symbol
  exposure/gross exposure/position size/order notional, buying power, required stop-loss, max
  risk per trade ($ and %), and minimum reward-to-risk ratio. Every decision is persisted as a
  `RiskEvent` tied to the order and the audit log. A user-triggered **emergency trading lock**
  (dashboard button + `POST /api/accounts/emergency-lock`) is wired all the way through to the
  risk engine.
- **Dashboard**: account equity/cash/buying-power/daily-P&L cards, open positions, open orders
  (with cancel), recent orders, an embedded order ticket, and the emergency-stop control.
- **Watchlists**: multiple named lists, add/remove symbols, live quotes (price/change/bid-ask/
  volume) per row, persisted to the database.
- **Charts**: real candlestick + volume chart (lightweight-charts) with timeframe selection and
  toggleable SMA/EMA/VWAP/RSI overlays, backed by the simulated candle API.
- **Scanner**: filters the local instrument universe by price/% change/volume (only fields the
  simulated provider actually supports — nothing fabricated), with saveable presets.
- **Order ticket**: MARKET/LIMIT/STOP/STOP_LIMIT, stop-loss/take-profit fields, live quote and
  estimated-notional display, risk-decision warnings shown inline, idempotency-keyed submission.
- **Journal**: CRUD entries (setup/strategy/confidence/emotional-state/pre-plan/post-review/tags),
  filterable by symbol.
- **Analytics**: win rate, avg win/loss, expectancy, profit factor, largest win/loss, max
  drawdown, longest win/loss streaks, breakdowns by symbol and day-of-week, CSV export — computed
  only from real closed positions, never fabricated.
- **Strategy builder**: a JSON rule DSL (price/SMA/EMA/VWAP crossovers and thresholds, RSI, %
  change, time-of-day; fixed-quantity or fixed-notional sizing; required stop-loss %; optional
  take-profit %; max trades/day) with a form-based (no-code) editor, versioning, and
  draft/active/paused/archived states; activation is blocked for an invalid version.
- **Backtesting engine**: event-driven, avoids look-ahead bias (entries/rule-exits fill at the
  *next* bar's open, never the signal bar's own close), fills stop-loss/take-profit intrabar at
  the clamped stop/target level, models commission/slippage/spread, enforces `maxPositions` and
  `maxTradesPerDay`, force-closes any open position at the end of the run. Produces net P&L,
  return %, win/loss rate, profit factor, expectancy, largest win/loss, max drawdown, avg holding
  time, Sharpe/Sortino (when there's enough data), an equity curve, and a full trade ledger with
  CSV/JSON export. Verified against a real 3-year AAPL backtest (58 trades, coherent metrics).
- **Paper strategy runner**: a background worker (`npm run worker`) polls every 60s, evaluates
  each active strategy's entry/exit rules using the *exact same evaluator* the backtester uses,
  and places orders through the normal risk-checked order pipeline. Per-run state (which
  positions it owns, consecutive error count) persists across restarts; idempotency keys prevent
  double-entry across overlapping ticks; a run auto-pauses after 5 consecutive errors; a
  kill-switch endpoint force-stops a run. Verified end-to-end: activation → real fill → repeat
  tick does not double-enter → kill switch stops it.
- **Alerts & notifications**: price/%-change/volume alert conditions evaluated by the same
  worker, deduplicated per-alert with a configurable cooldown. In-app notifications also fire on
  order fills, order rejections, and strategy auto-pause, all through one deduped path so future
  email/SMS/push providers can hang off it without touching call sites.
- **Admin**: role-gated `/admin` (server-side redirect for non-admins, plus a guard on every
  admin API route) for user management (activate/deactivate — revokes sessions; promote/demote
  role), feature flags (enabling `live_trading` is explicitly rejected — see below), and a
  searchable audit-log viewer.
- **Tests**: 77 Vitest unit/integration tests (indicators, risk engine — ~20 rule-by-rule cases,
  strategy evaluator, backtest engine including a real caught-and-fixed `maxPositions` bug,
  determinism of the simulated data generator, password strength, full order lifecycle and auth
  flows against the real database) + 9 Playwright e2e tests (registration, login failure/success,
  protected-route redirect, watchlist add/remove, a real rendered chart, risk-rejected order, a
  filled order appearing in positions, resting-limit-order cancel) — all passing. GitHub Actions
  CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit/integration tests, build, and the
  full e2e suite against Postgres/Redis service containers on every push/PR.
- **Docs**: README, this file, ARCHITECTURE.md (with Mermaid diagrams), SECURITY.md,
  CONTRIBUTING.md, docs/THREAT_MODEL.md, docs/COMPLIANCE_CHECKLIST.md, docs/DEPLOYMENT.md,
  docs/TROUBLESHOOTING.md.

## Not built in this pass

- **File attachments for journal entries** (screenshots): the schema supports it
  (`Attachment` model) but there's no file-storage backend or upload UI.
- **A dedicated admin-initiated emergency lock on *another* user's account** — today the
  emergency-lock endpoint only lets a user lock their own account; an admin can't remotely lock
  someone else's from the UI (would need a small additional admin API route).
- **SMS/push notification providers** — the `EmailProvider`-style interface pattern is in place
  for email and notifications are dedupe-ready for more channels, but no SMS/push provider
  adapter has been implemented (in-app notifications work today).
- **A native mobile client** — out of scope for this pass, but the backend is a REST/JSON API
  (not tied to server-rendered pages) specifically so one could be built against it later.

## Key assumptions and design decisions

- **Single account per user** in v1. Multi-account support would be a schema-compatible
  extension later.
- **Auth is custom-built**, not next-auth: DB-backed sessions were needed for user-controlled
  revocation, which doesn't fit next-auth's credentials-provider model cleanly.
- **CSRF**: relies on `SameSite=Lax` cookies plus requiring `Content-Type: application/json` on
  state-changing requests (see SECURITY.md for the reasoning). No separate CSRF token scheme.
- **Decimal arithmetic** in portfolio/risk code uses JS `number` after converting Prisma
  `Decimal` values via `Number()`, not an arbitrary-precision library. Fine for simulated paper
  trading; would need revisiting before ever touching real money.
- **Market holiday calendar is not modeled** — every Monday-Friday is a trading day. Only the US
  equity regular session (09:30-16:00 America/New_York) is modeled; extended-hours orders are
  rejected while the market is closed (extended-hours trading isn't supported).
- **STOP_LIMIT orders** are simplified: stop and limit conditions are evaluated together on each
  matching pass rather than modeling a persistent "triggered" sub-state.
- **No partial fills are simulated** — the matching engine and backtester always fill an order's
  entire remaining quantity at once. The schema supports partial fills for when this is added.
- **Buying power** uses a flat 2x cash multiplier (simplified reg-T-like model). Real margin/PDT
  rules are explicitly out of scope (see docs/COMPLIANCE_CHECKLIST.md).
- **TypeScript/ESLint versions**: pinned to TypeScript 6.0.3 and ESLint 9.39.5 rather than the
  newest published majors (TypeScript 7.0.2, ESLint 10.8.0) because `typescript-eslint` (used by
  `eslint-config-next`) does not yet support either — confirmed by hard runtime failures, not
  guesswork (tracked upstream: typescript-eslint/typescript-eslint#10940).
- **Prisma 7 requires an explicit driver adapter** (`@prisma/adapter-pg`) at runtime.
- **The strategy runner is a poll loop, not BullMQ** — simpler for "re-evaluate every N seconds"
  than a job queue; BullMQ remains a reasonable choice for future discrete background jobs.

## Known limitations / follow-ups for a professional review

- No dedicated CSRF token scheme (SameSite + content-type check only — see SECURITY.md).
- No API-level rate limiting on trading endpoints (only auth endpoints are rate-limited).
- No dependency/SAST scanning wired into CI yet.
- No formal secret-rotation procedure for `CREDENTIALS_ENCRYPTION_KEY`/`SESSION_SECRET`.
- No `Candle` table retention/pruning job yet — it will grow with usage (see docs/DEPLOYMENT.md).
- Live-trading is fully gated off (`FEATURE_LIVE_TRADING_ENABLED=false`,
  `BrokerConnection.isLiveTradingReady` always `false`, and the admin API explicitly rejects
  enabling the `live_trading` flag) — the acknowledgement flow described in the product brief has
  not been built; live trading cannot be enabled at all right now, by design.
- Terms of Use, Privacy Policy, and jurisdictional scope are placeholders only — see
  docs/COMPLIANCE_CHECKLIST.md for the full unresolved list.
- No formal penetration test or third-party security review has been performed.
