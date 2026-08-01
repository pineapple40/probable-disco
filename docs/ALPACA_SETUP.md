# Connecting a real Alpaca paper account

This app defaults to a fully self-contained simulated broker and simulated market data - no
external account needed. This guide covers the optional alternative: routing order placement and
market data through [Alpaca](https://alpaca.markets)'s own **paper trading** environment instead.

**This is still not real money.** Alpaca's paper endpoint (`https://paper-api.alpaca.markets`) is
Alpaca's own sandbox: real market data and realistic order behavior, but a fake cash balance that
never touches your bank account or a real brokerage account. Enabling this does **not** enable
live trading in this app - `FEATURE_LIVE_TRADING_ENABLED` is a separate, still-hard-disabled flag
(see `SECURITY.md`).

## 1. Get free Alpaca paper API keys

1. Sign up at [alpaca.markets](https://alpaca.markets) (free).
2. In the dashboard, make sure you're viewing **Paper Trading** (not Live) - Alpaca shows a
   toggle for this.
3. Generate an API key pair (key ID + secret). Alpaca only shows the secret once - copy both
   somewhere safe.
4. Read Alpaca's own Paper Trading and API Terms of Service before proceeding - this is an
   agreement between you and Alpaca, independent of this app.

## 2. Configure this app

Add to your `.env` (see `.env.example` for the full list):

```bash
BROKER_PROVIDER=alpaca
MARKET_DATA_PROVIDER=alpaca
ALPACA_API_KEY=your-key-id
ALPACA_API_SECRET=your-secret
# Defaults shown - only change if Alpaca changes their URLs:
ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets
```

Restart the app and the background worker (`npm run dev` / `npm run worker`) after changing these.

## 3. What actually changes

- **Order placement** (`src/server/broker/alpaca/adapter.ts`): market/limit orders, and
  stop-loss/take-profit as a native Alpaca bracket/OTO order, are submitted to Alpaca's paper
  endpoint instead of being filled instantly by the local simulated matching engine.
- **Fills are asynchronous now.** A submitted order shows as `NEW` until the background worker's
  next tick (`npm run worker`, every 60s) polls Alpaca and reconciles the fill - unlike the
  simulated engine, which fills synchronously on submission. Make sure the worker process is
  running, or fills will never show up in the UI.
- **Market data** (`src/server/market-data/alpaca.ts`): quotes and candles come from Alpaca's
  Market Data API (free IEX-feed tier) instead of the deterministic simulated feed. Candle rows
  fetched this way are tagged `sourceType: REALTIME` in the database.

## 4. What does not change

- The account's cash/equity/buying-power model, the risk engine, position accounting, journal,
  analytics, and backtesting are entirely unaffected - they operate on the exact same
  `Account`/`Order`/`Execution`/`Position` rows regardless of which broker filled them.
- `BROKER_PROVIDER` is a single global switch for the whole deployment (not per-user). Running a
  mix of simulated and Alpaca-routed orders in one deployment is not supported - switching modes
  is meant for a personal, single-operator deployment connecting your own Alpaca paper account.

## 5. Before going further

If you're considering eventually enabling Alpaca's **live** (real-money) endpoint instead of
paper, stop and read `docs/COMPLIANCE_CHECKLIST.md` in full first - live trading is a separate,
currently hard-disabled feature flag in this app for a reason, and several checklist items
(PDT/margin enforcement, a real acknowledgement flow, legal review) are explicitly unresolved
prerequisites.
