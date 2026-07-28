# Architecture

## Overview

Probable Disco is a single Next.js application (App Router) that serves both the UI (React
Server/Client Components) and the API (Route Handlers under `src/app/api/**`), backed by
PostgreSQL (via Prisma) and Redis. A separate long-running Node process (`npm run worker`) runs
the paper strategy runner and alert evaluator on an interval. Everything - market data, the
broker, order matching - is simulated in-process; nothing here talks to a real exchange.

```mermaid
flowchart LR
    subgraph Client
        Browser["Browser (React)"]
    end

    subgraph App["Next.js app (single deployable)"]
        UI["App Router pages\n(Server + Client Components)"]
        API["Route handlers\nsrc/app/api/**"]
        Services["Service layer\nsrc/server/**"]
    end

    Worker["Background worker\n(npm run worker)\nstrategy runner + alerts"]

    Postgres[("PostgreSQL")]
    Redis[("Redis\n(rate limiting, sessions cache)")]

    Browser <--> UI
    UI --> API
    API --> Services
    Services --> Postgres
    Services --> Redis
    Worker --> Services
    Worker --> Postgres
    Worker --> Redis
```

## Request flow: placing an order

```mermaid
sequenceDiagram
    participant U as Browser
    participant R as Route handler (/api/orders)
    participant O as orders/service.ts
    participant Ctx as risk/context.ts
    participant Risk as risk/engine.ts (pure)
    participant B as broker/simulated.ts
    participant DB as PostgreSQL

    U->>R: POST /api/orders {symbol, side, qty, stopLoss, idempotencyKey}
    R->>O: placeOrder(userId, input)
    O->>DB: check idempotencyKey (replay if exists)
    O->>Ctx: buildRiskCheckContext(account, instrument)
    Ctx->>DB: risk profile, positions, exposure, PnL, quote
    O->>Risk: evaluateOrderRisk(order, context)
    Risk-->>O: {allowed, ruleKey, message, warnings}
    O->>DB: create Order + RiskEvent + OrderEvent (transaction)
    alt allowed
        O->>B: attemptImmediateFill(orderId)
        B->>DB: Execution + Position + Account update (transaction)
    end
    O-->>R: order + riskDecision
    R-->>U: 200/201 JSON
```

The risk engine (`src/server/risk/engine.ts`) is a pure function with no I/O, so it's unit
tested directly with hand-built contexts (see `tests/unit/risk-engine.test.ts`) - the only I/O
is in `risk/context.ts`, which assembles its input from the database.

## Strategy execution: one evaluator, two runners

Both the backtester and the live paper strategy runner call the exact same condition evaluator
(`src/server/strategy/evaluator.ts`), so a strategy's backtested behavior and its live paper
behavior can never silently diverge:

```mermaid
flowchart TB
    Def["StrategyDefinition\n(entry/exit rules, sizing, stops)"]
    Eval["evaluateEntry / evaluateExit\n(pure, index-bounded - never sees future bars)"]

    Def --> Eval

    subgraph Backtest["Backtest engine (src/server/backtesting/engine.ts)"]
        BLoop["Walk historical bars\nnext-bar-open fills\nintrabar stop/target fills"]
    end

    subgraph Runner["Paper strategy runner (src/server/worker/strategyRunner.ts)"]
        RLoop["Poll every 60s\nsame evaluator against\nrecent simulated bars"]
    end

    Eval --> BLoop
    Eval --> RLoop
    RLoop --> OrderService["orders/service.ts\n(same risk-checked path\nas manual orders)"]
```

## Market data

`src/server/market-data/provider.ts` defines a `MarketDataProvider` interface
(`getQuote`, `getCandles`) with one implementation today, `SimulatedMarketDataProvider`. A real
(licensed) provider would implement the same interface and be registered in
`getMarketDataProvider()` - no other code depends on the simulated provider's internals.

- **Candles** are a seeded random walk (mulberry32 PRNG + clamped Box-Muller shocks), always
  replayed forward from a fixed epoch, so the same symbol produces the same historical path on
  every run - important for reproducible backtests. Daily candles are cached in Postgres on
  first request; intraday candles (M1/M5/M15/H1) are a Brownian bridge anchored to the cached
  daily candle, bounded to a 30-day window.
- **Live quotes** are computed on demand from the day's cached candle plus the current
  America/New_York session state (DST-aware via `Intl`) - no per-tick data is persisted, to avoid
  unbounded row growth in a table not designed for high-frequency retention.

## Data model

See `prisma/schema.prisma` for the full schema. The core entities:

```mermaid
erDiagram
    User ||--o| MfaConfig : has
    User ||--o{ Session : has
    User ||--|| Role : has
    User ||--o{ Account : owns
    Account ||--|| BrokerConnection : uses
    Account ||--o{ Order : places
    Account ||--o{ Position : holds
    Account ||--|| RiskProfile : governed_by
    Order ||--o{ Execution : fills_via
    Order ||--o{ OrderEvent : logs
    Order ||--o{ RiskEvent : evaluated_by
    User ||--o{ Strategy : authors
    Strategy ||--o{ StrategyVersion : versions
    StrategyVersion ||--o{ StrategyRun : runs
    StrategyVersion ||--o{ Backtest : backtests
    Backtest ||--o{ BacktestTrade : produces
    User ||--o{ Watchlist : manages
    Watchlist ||--o{ WatchlistSymbol : contains
    Instrument ||--o{ Candle : has
    Instrument ||--o{ WatchlistSymbol : referenced_by
```

## Why these choices

- **Custom auth instead of next-auth**: user-controlled session revocation needed a DB-backed
  session table, which doesn't fit next-auth's credentials-provider model (JWT-only) cleanly.
- **Prisma 7 driver adapters**: Prisma 7 requires an explicit driver adapter
  (`@prisma/adapter-pg`) - there's no more implicit query-engine-binary connection from a bare
  `DATABASE_URL`.
- **TypeScript 6.0.3 / ESLint 9.39.5, not the newest majors**: `typescript-eslint` (used by
  `eslint-config-next`) doesn't yet support TypeScript 7 or the ESLint 10 Linter API - confirmed
  by hard runtime failures during setup, not guesswork. Re-evaluate once upstream catches up.
- **Long-only in v1**: matches the documented product scope (short selling excluded pending
  proper borrow-availability modeling). Enforced in both the portfolio accounting layer and the
  risk engine.
- **No partial fills simulated**: the matching engine fills a triggered order's entire remaining
  quantity at once. The schema supports partial fills (`filledQuantity`, `PARTIALLY_FILLED`) for
  when order-book-depth simulation is added.
- **A poll loop, not BullMQ, for the strategy runner**: the workload is "re-evaluate every active
  run every N seconds," which a plain `setInterval` expresses more simply than a job queue. BullMQ
  is still a dependency and a reasonable choice if discrete one-off background jobs (e.g. bulk
  data imports) are added later.

## Directory guide

```
src/
  app/                  Next.js routes (pages under (auth)/(app), API under api/**)
  components/           UI kit (components/ui) and trading-specific components
  hooks/                Client-side TanStack Query hooks
  lib/                  Framework-agnostic utilities (env, db, redis, indicators, crypto, ...)
  server/               Business logic, organized by domain (auth, orders, risk, strategy, ...)
  generated/prisma/     Generated Prisma client (not hand-edited)
prisma/                 Schema, migrations, seed script
tests/
  unit/                 Pure-function tests (no DB)
  integration/          Tests against the real Postgres/Redis stack
  e2e/                  Playwright browser tests
docs/                   Threat model, compliance checklist, deployment, troubleshooting
```
