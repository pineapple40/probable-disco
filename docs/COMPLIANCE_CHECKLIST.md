# Compliance Checklist

**Nothing in this document constitutes legal advice or a representation that this application is
legally approved for any use.** It is a working list of compliance-relevant topics a real
deployment must have reviewed by qualified counsel before handling real money, real brokerage
connections, or real user funds. Every item below is currently **unresolved** unless marked done.

## Legal disclaimers present in the app

- [x] Risk disclosure banner shown persistently while in the app (simulated-data banner in the
      app shell).
- [x] Backtesting results are labeled hypothetical (`/backtests` page copy).
- [x] Paper-trading disclaimer shown on every order ticket submission.
- [x] No-guaranteed-results statement (README, backtests page).
- [ ] Formal Terms of Use document (placeholder only - not drafted).
- [ ] Formal Privacy Policy document (placeholder only - not drafted).
- [ ] Market-data attribution / licensing notice (not applicable yet - only simulated data is
      used; required once a real data provider is added, per that provider's redistribution terms).
- [ ] Broker-specific disclosures (not applicable yet - only a simulated broker exists).

## Broker API terms

- **Not applicable today** - the only broker adapter implemented is the simulated one. An Alpaca
  (or other) paper-broker adapter is explicitly out of scope for this pass (see
  PROJECT_STATUS.md); before adding one, review:
  - [ ] The broker's API Terms of Service, including any restrictions on automated trading,
        rate limits, and required disclosures to end users.
  - [ ] Whether the broker requires a signed agreement before production API access.
  - [ ] Whether the broker's paper-trading environment has its own separate terms.

## Market-data licensing

- **Not applicable today** - only simulated, clearly-labeled mock data is used; no real market
  data is fetched, displayed, or redistributed anywhere in the app.
- Before adding a real (even delayed) market-data provider:
  - [ ] Review the provider's redistribution/display terms (e.g. exchange-required attribution,
        per-user licensing fees for real-time data, delayed-data disclosure requirements).
  - [ ] Confirm whether the provider requires an executed data agreement before production use.

## Pattern Day Trader (PDT) / margin rules

- Not enforced. The simulated account uses a flat 2x cash "buying power" multiplier
  (`BUYING_POWER_MULTIPLIER` in `src/server/portfolio/accounting.ts`) with **no** PDT
  day-trade-count enforcement, no $25,000 minimum-equity check, and no FINRA/exchange margin
  maintenance-requirement modeling. This is explicitly out of scope for this release (margin
  calculations beyond verified broker-provided values are excluded per the product brief).
  Before enabling any real margin trading: implement real PDT tracking and get the resulting
  logic reviewed against current FINRA Rule 4210 and the specific broker's own margin agreement.

## Short-sale restrictions

- Not applicable - short selling is not supported in this release (long-only, enforced in both
  the portfolio-accounting layer and the risk engine). Before adding short selling: implement
  locate/borrow-availability checks, Regulation SHO close-out requirements, and the specific
  broker's short-locate process.

## Options / futures / forex / crypto

- Not implemented, explicitly excluded from this release's scope (US-listed equities and ETFs
  only). Each would carry its own regulatory regime (options: OCC/FINRA options disclosure
  document requirements; futures: NFA/CFTC; forex: NFA; crypto: state money-transmitter and/or
  SEC/CFTC questions depending on the asset) that would need independent legal review.

## Investment-adviser / signal-service concerns

- The strategy builder and backtester operate entirely on the user's own configuration and never
  recommend, rank, or push a strategy to other users - there is no multi-user signal
  distribution, so this app does not currently do anything that resembles giving personalized
  investment advice to third parties. If a "share my strategy" or "copy trading" feature is ever
  added (explicitly out of scope per the product brief), investment-adviser registration
  questions (Investment Advisers Act of 1940, state-level equivalents) must be reviewed before
  building it.

## Privacy / data retention

- [ ] No formal data-retention policy has been defined or implemented (no automatic deletion of
      old audit events, journal entries, or account data).
- [ ] No documented process for a user to request data export or account deletion (right to
      erasure / data portability, relevant under GDPR/CCPA-type regimes depending on jurisdiction).
- [x] Passwords are hashed, never stored in plaintext or logged.
- [x] Broker credentials are encrypted at rest.
- [ ] No formal review of what jurisdiction(s) this app is intended to operate in, which
      determines which privacy regimes actually apply.

## Jurisdictional scope

- Not defined. The product brief targets US-listed equities/ETFs, but the application itself does
  not currently restrict signups by geography, verify user residency, or display
  jurisdiction-specific disclosures. This must be decided (and enforced, if needed) before any
  real deployment.

## Live-trading enablement checklist (currently blocked by design)

Live trading is hard-disabled (`FEATURE_LIVE_TRADING_ENABLED=false`, and the admin API rejects
enabling the `live_trading` feature flag - see SECURITY.md). Before it could ever be enabled:

- [ ] Legal review of every item in this checklist, completed and signed off.
- [ ] A real broker integration reviewed against that broker's own compliance requirements.
- [ ] A explicit, logged user acknowledgement flow (not just an admin toggle) confirming the user
      understands they are enabling real-money trading.
- [ ] PDT/margin enforcement matching the real broker's actual rules.
- [ ] Terms of Use and Privacy Policy finalized by counsel, not placeholders.
- [ ] A defined incident-response process for a live-trading-specific outage or erroneous fill.
