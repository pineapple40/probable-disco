import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const INSTRUMENTS = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corporation" },
  { symbol: "GOOGL", name: "Alphabet Inc. Class A" },
  { symbol: "AMZN", name: "Amazon.com, Inc." },
  { symbol: "NVDA", name: "NVIDIA Corporation" },
  { symbol: "META", name: "Meta Platforms, Inc." },
  { symbol: "TSLA", name: "Tesla, Inc." },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc." },
  { symbol: "NFLX", name: "Netflix, Inc." },
  { symbol: "JPM", name: "JPMorgan Chase & Co." },
  { symbol: "BAC", name: "Bank of America Corporation" },
  { symbol: "XOM", name: "Exxon Mobil Corporation" },
  { symbol: "DIS", name: "The Walt Disney Company" },
  { symbol: "INTC", name: "Intel Corporation" },
  { symbol: "CRM", name: "Salesforce, Inc." },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust" },
  { symbol: "QQQ", name: "Invesco QQQ Trust" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF" },
];

async function main() {
  console.log("Seeding roles...");
  const traderRole = await prisma.role.upsert({
    where: { key: "trader" },
    update: {},
    create: {
      key: "trader",
      name: "Trader",
      permissions: [
        "watchlists:manage",
        "orders:place",
        "orders:cancel",
        "strategies:manage",
        "backtests:run",
        "journal:manage",
        "alerts:manage",
        "account:read",
      ],
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { key: "admin" },
    update: {},
    create: {
      key: "admin",
      name: "Administrator",
      permissions: [
        "admin:users:manage",
        "admin:providers:manage",
        "admin:feature_flags:manage",
        "admin:audit:read",
        "admin:system:manage",
      ],
    },
  });

  console.log("Seeding instruments...");
  for (const instrument of INSTRUMENTS) {
    await prisma.instrument.upsert({
      where: { symbol: instrument.symbol },
      update: { name: instrument.name },
      create: {
        symbol: instrument.symbol,
        name: instrument.name,
        assetClass: "us_equity",
        exchange: "SIMULATED",
        isTradable: true,
        isFractionable: instrument.symbol !== "BRK.A",
      },
    });
  }

  console.log("Seeding demo trader account...");
  const traderPasswordHash = await hashPassword("Demo!Trader123");
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@probable-disco.local" },
    update: {},
    create: {
      email: "demo@probable-disco.local",
      passwordHash: traderPasswordHash,
      displayName: "Demo Trader",
      roleId: traderRole.id,
      emailVerifiedAt: new Date(),
    },
  });

  const brokerConnection = await prisma.brokerConnection.upsert({
    where: { id: `${demoUser.id}-sim-broker` },
    update: {},
    create: {
      id: `${demoUser.id}-sim-broker`,
      userId: demoUser.id,
      provider: "SIMULATED",
      label: "Simulated Paper Broker",
      isPaper: true,
      isLiveTradingReady: false,
      status: "connected",
      lastCheckedAt: new Date(),
    },
  });

  await prisma.marketDataConnection.upsert({
    where: { id: `${demoUser.id}-sim-data` },
    update: {},
    create: {
      id: `${demoUser.id}-sim-data`,
      userId: demoUser.id,
      provider: "simulated",
      sourceType: "SIMULATED",
      status: "connected",
      lastCheckedAt: new Date(),
    },
  });

  const account = await prisma.account.upsert({
    where: { id: `${demoUser.id}-paper-account` },
    update: {},
    create: {
      id: `${demoUser.id}-paper-account`,
      userId: demoUser.id,
      brokerConnectionId: brokerConnection.id,
      label: "Paper Trading Account",
      currency: "USD",
      cash: 100000,
      equity: 100000,
      buyingPower: 200000,
      isPaper: true,
    },
  });

  await prisma.riskProfile.upsert({
    where: { userId: demoUser.id },
    // The demo account is used by e2e tests that place orders at whatever
    // wall-clock time CI happens to run (including outside NYSE hours, or on
    // a weekend) - restrictedHoursOnly must stay off here or those tests
    // become flaky based on when CI runs, not on any actual bug. Same
    // reasoning tests/integration/orders.test.ts already documents.
    update: { restrictedHoursOnly: false },
    create: {
      userId: demoUser.id,
      accountId: account.id,
      restrictedHoursOnly: false,
    },
  });

  await prisma.emergencyTradingLock.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      accountId: account.id,
      isLocked: false,
    },
  });

  const watchlist = await prisma.watchlist.upsert({
    where: { userId_name: { userId: demoUser.id, name: "Core Watchlist" } },
    update: {},
    create: { userId: demoUser.id, name: "Core Watchlist" },
  });

  const defaultSymbols = ["AAPL", "MSFT", "NVDA", "TSLA", "SPY"];
  for (let i = 0; i < defaultSymbols.length; i++) {
    const symbol = defaultSymbols[i];
    const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol } });
    await prisma.watchlistSymbol.upsert({
      where: { watchlistId_instrumentId: { watchlistId: watchlist.id, instrumentId: instrument.id } },
      update: {},
      create: { watchlistId: watchlist.id, instrumentId: instrument.id, sortOrder: i },
    });
  }

  console.log("Seeding demo admin account...");
  const adminPasswordHash = await hashPassword("Demo!Admin123");
  await prisma.user.upsert({
    where: { email: "admin@probable-disco.local" },
    update: {},
    create: {
      email: "admin@probable-disco.local",
      passwordHash: adminPasswordHash,
      displayName: "Demo Admin",
      roleId: adminRole.id,
      emailVerifiedAt: new Date(),
    },
  });

  console.log("Seeding feature flags...");
  const flags: Array<{ key: string; description: string; enabled: boolean }> = [
    { key: "live_trading", description: "Enables the live-trading acknowledgement flow.", enabled: false },
    { key: "mfa", description: "Allows users to enable TOTP multi-factor authentication.", enabled: true },
    { key: "signup", description: "Allows new users to self-register.", enabled: true },
  ];
  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {},
      create: flag,
    });
  }

  console.log("Seed complete.");
  console.log("Demo trader login: demo@probable-disco.local / Demo!Trader123");
  console.log("Demo admin login:  admin@probable-disco.local / Demo!Admin123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
