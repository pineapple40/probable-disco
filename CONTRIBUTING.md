# Contributing

## Getting set up

```bash
cp .env.example .env
npm install
npm run docker:up
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

## Before opening a PR

Run everything CI runs, in this order:

```bash
npm run lint
npm run typecheck
npm run test          # unit + integration (needs docker:up running)
npm run build
npx playwright install --with-deps chromium   # first time only
npm run test:e2e
```

All five must pass. `npm run test` and `npm run test:e2e` both need Postgres/Redis reachable
(`npm run docker:up`) and a seeded database (`npm run db:seed`) - the e2e suite logs in as the
seeded demo trader.

## Code conventions

- **TypeScript strict mode** is on; don't add `any` or `@ts-ignore` to work around a type error -
  fix the type.
- **No comments explaining what code does** - names should do that. A comment is only for a
  non-obvious *why* (a workaround, an invariant, a deliberately-simplified assumption).
- **Server-only business logic lives under `src/server/**`**, organized by domain (`auth`,
  `orders`, `risk`, `strategy`, `market-data`, ...), not by layer. Route handlers under
  `src/app/api/**` should stay thin: validate input, call a service function, map the result to a
  response.
- **Pure logic stays pure.** The risk engine (`risk/engine.ts`) and the strategy evaluator
  (`strategy/evaluator.ts`) take no dependencies and do no I/O - that's what makes them fast to
  unit test. If you need a DB read to make a decision, do it in the calling context-builder
  (`risk/context.ts`), not inside the pure function.
- **Zod schemas validate every request body/query string** before it reaches business logic.
- **Every user-facing mutation should be audited** via `recordAuditEvent()` if it's a
  security-relevant or financially-relevant action (auth, orders, risk decisions, strategy
  lifecycle, admin actions).

## Adding a new market-data or broker provider

Implement the `MarketDataProvider` (`src/server/market-data/provider.ts`) or `BrokerAdapter`
(`src/server/broker/types.ts`) interface and register it in the relevant factory function
(`getMarketDataProvider()` / wherever the broker is selected). Don't add provider-specific
branches to call sites outside that provider's own file.

## Database changes

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate` — creates and applies a new migration, prompts for a name.
3. Commit the generated `prisma/migrations/<timestamp>_<name>/` directory.
4. If the change affects seed data, update `prisma/seed.ts` too.

## Tests

- New pure logic (indicators, risk rules, strategy conditions, backtest math) → unit test in
  `tests/unit/`, no DB.
- New service-layer behavior that touches Postgres → integration test in `tests/integration/`,
  using a throwaway user/account created and deleted within the test (see
  `tests/integration/orders.test.ts` for the pattern) - never mutate the seeded demo account's
  data from a test.
- New critical user-facing workflow → Playwright spec in `tests/e2e/`. Reuse the saved demo
  session (`test.use({ storageState: "tests/e2e/.auth/demo.json" })`) rather than logging in
  per-test where possible, to avoid exhausting the login rate limiter across a full suite run.

## Commit messages

Explain *why*, not *what* - the diff already shows what changed.
