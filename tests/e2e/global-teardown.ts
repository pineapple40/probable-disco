import { execSync } from "node:child_process";

/**
 * Resets the demo trader's transactional data after the e2e suite runs, so
 * repeated runs stay deterministic (no accumulating orders/positions from
 * previous runs affecting buying-power or cooldown-based risk checks).
 */
export default async function globalTeardown() {
  try {
    execSync(
      `docker exec probable-disco-postgres psql -U trader -d probable_disco -c "
        delete from \\"RiskEvent\\" where \\"userId\\" in (select id from \\"User\\" where email='demo@probable-disco.local');
        delete from \\"OrderEvent\\" where \\"orderId\\" in (select o.id from \\"Order\\" o join \\"Account\\" a on o.\\"accountId\\"=a.id join \\"User\\" u on a.\\"userId\\"=u.id where u.email='demo@probable-disco.local');
        delete from \\"Execution\\" where \\"orderId\\" in (select o.id from \\"Order\\" o join \\"Account\\" a on o.\\"accountId\\"=a.id join \\"User\\" u on a.\\"userId\\"=u.id where u.email='demo@probable-disco.local');
        delete from \\"Order\\" where \\"accountId\\" in (select a.id from \\"Account\\" a join \\"User\\" u on a.\\"userId\\"=u.id where u.email='demo@probable-disco.local');
        delete from \\"Position\\" where \\"accountId\\" in (select a.id from \\"Account\\" a join \\"User\\" u on a.\\"userId\\"=u.id where u.email='demo@probable-disco.local');
        delete from \\"Watchlist\\" where \\"userId\\" in (select id from \\"User\\" where email='demo@probable-disco.local') and name <> 'Core Watchlist';
        update \\"Account\\" set cash=100000, equity=100000, \\"buyingPower\\"=200000 where \\"userId\\" in (select id from \\"User\\" where email='demo@probable-disco.local');
        update \\"User\\" set \\"failedLoginCount\\"=0, \\"lockedUntil\\"=NULL where email='demo@probable-disco.local';
      "`,
      { stdio: "pipe" },
    );
  } catch {
    // Best-effort cleanup; never fail the test run because cleanup failed.
  }
}
