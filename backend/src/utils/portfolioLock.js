const { AsyncMutex } = require('./asyncMutex');

/**
 * T-023 (2026-08-18, PM continuous-improvement pass): closes a real,
 * currently-live data-integrity race.
 *
 * `virtualTrackingJob.js` registers two independent cron schedules in the
 * same process: `runVirtualTrackingCycle` every 5 minutes (cron: every-5-
 * minutes) and `runFundingCycle` three times a day at 00:00/08:00/16:00
 * UTC (cron: those three hours). At 00:00, 08:00, and 16:00 UTC those two
 * schedules land on the same tick -- both fire concurrently. Both eventually call
 * into virtualTrackingService.js functions (`checkOpenTrades`,
 * `applyFundingPayments`, and separately `closePositionNow` for the
 * manual "Sell Now" HTTP route) that do a plain fetch -> in-memory mutate
 * -> `portfolio.save()` on the single shared VirtualPortfolio document
 * (`currentBalance`, `totalProfit`, `totalLoss`, `balanceHistory`, etc.),
 * with no coordination between them. That is a classic lost-update race:
 * whichever save() lands second silently overwrites the first's changes,
 * corrupting the paper-trading balance -- not hypothetical, demonstrable
 * given the confirmed-overlapping cron schedules above.
 *
 * Fix: every critical section that reads-mutates-saves the portfolio is
 * wrapped in this single shared lock, so only one such section actually
 * runs at a time -- the others simply queue and see a fully up-to-date
 * portfolio, not a stale in-memory copy. See asyncMutex.js for why an
 * in-process mutex (not a DB-level lock) is the correct fix for this app's
 * actual deployment model.
 */
const portfolioMutex = new AsyncMutex();

function withPortfolioLock(fn) {
  return portfolioMutex.run(fn);
}

module.exports = { withPortfolioLock };
