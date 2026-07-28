# Probable Disco

A local, paper-trading day-trading platform for US equities and ETFs. Everything runs against
simulated market data and a simulated broker — **no real money is ever at risk**, and live
trading is disabled by default and cannot be turned on from the UI (see [SECURITY.md](SECURITY.md)).

Built with Next.js (App Router), TypeScript (strict mode), PostgreSQL, Prisma, and Redis.

## Quick start

Requirements: Node.js 20.9+, Docker, and Docker Compose.

```bash
cp .env.example .env
npm install
npm run docker:up          # starts Postgres + Redis
npm run db:migrate:deploy  # applies the schema
npm run db:seed            # creates demo accounts and a US equity/ETF instrument universe
npm run dev                # http://localhost:3000
```

Demo logins:

| Role   | Email                        | Password         |
| ------ | ---------------------------- | ---------------- |
| Trader | `demo@probable-disco.local`  | `Demo!Trader123`  |
| Admin  | `admin@probable-disco.local` | `Demo!Admin123`   |

To run a paper strategy in the background (evaluates active strategies and simulated price
alerts every 60 seconds):

```bash
npm run worker
```

## What's here

- **Auth**: registration, email verification, password reset, optional TOTP MFA, account
  lockout, Redis-backed rate limiting, role-based authorization (trader/admin).
- **Market data**: a deterministic simulated feed (candles + live quotes) behind a
  provider-neutral interface, so a real (licensed) data provider can be swapped in later.
- **Paper broker**: simulated MARKET/LIMIT/STOP/STOP_LIMIT orders, a matching engine for resting
  orders, idempotent order submission, and long-only position/P&L accounting.
- **Risk engine**: server-side pre-trade checks (max risk per trade, daily/weekly loss lockout,
  exposure limits, required stop-loss, minimum reward-to-risk, market-hours-only, and more),
  every decision audited.
- **Dashboard, watchlists, charts (lightweight-charts), scanner, order ticket.**
- **Journal and analytics** (win rate, expectancy, profit factor, drawdown, CSV export).
- **Rule-based strategy builder** and an **event-driven backtesting engine** (no look-ahead bias,
  next-bar-open fills, commission/slippage/spread modeling, Sharpe/Sortino, CSV/JSON export).
- **Paper strategy runner**: a background worker that runs active strategies against simulated
  data through the same risk-checked order pipeline as manual trading, with a kill switch.
- **Alerts & in-app notifications**, deduplicated with per-alert cooldowns.
- **Admin panel**: user management, feature flags, and a searchable audit log.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for exactly what's implemented, what's simplified, and
what's left. See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together.

## Scripts

| Command                      | What it does                                                |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run dev`                 | Start the Next.js dev server                                 |
| `npm run build`                | Production build                                             |
| `npm run start`                | Run the production build                                     |
| `npm run worker`                | Run the paper strategy runner / alert evaluator              |
| `npm run lint`                 | ESLint                                                        |
| `npm run typecheck`            | `tsc --noEmit`                                                |
| `npm run test`                  | Vitest unit + integration tests                               |
| `npm run test:e2e`              | Playwright end-to-end tests                                   |
| `npm run db:migrate`            | Create/apply a dev migration                                  |
| `npm run db:migrate:deploy`     | Apply migrations (production-safe, no schema drift check)     |
| `npm run db:seed`                | Seed demo data                                                |
| `npm run db:studio`              | Prisma Studio                                                 |
| `npm run docker:up` / `docker:down` | Start/stop Postgres + Redis                              |

## Environment variables

See [`.env.example`](.env.example) — every variable is documented there. Nothing is required
beyond what's already filled in to run locally; broker/market-data provider credentials are
optional and only needed if you later wire up a real (still paper) provider.

## Production build

```bash
docker build -t probable-disco .
docker run -p 3000:3000 --env-file .env probable-disco
```

The image is a multi-stage build producing a Next.js `standalone` output. It still needs a
reachable Postgres and Redis (via `DATABASE_URL` / `REDIS_URL`) — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for a full deployment checklist.

## Health checks

- `GET /api/health` — liveness (process is up).
- `GET /api/ready` — readiness (Postgres and Redis are reachable).

## Documentation

- [PROJECT_STATUS.md](PROJECT_STATUS.md) — what's done, assumptions, known limitations.
- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data model, diagrams.
- [SECURITY.md](SECURITY.md) — security posture, what's implemented, how to report an issue.
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev workflow, coding conventions, test expectations.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Scope and disclaimers

This is a **paper-trading** platform for US-listed equities and ETFs. Backtests and simulated
fills are hypothetical and depend on the stated assumptions (commission/slippage/spread models,
a simplified trading calendar with no holidays modeled) — see PROJECT_STATUS.md for the full list.
Nothing in this repository should be interpreted as investment advice or a guarantee of any
trading outcome.
