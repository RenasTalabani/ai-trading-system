/**
 * Regression suite for T-031 (2026-08-18, PM continuous-improvement pass).
 *
 * Bug: generateHourlyReport() queried VirtualPortfolio.findOne({ key:
 * 'global' }), but the schema's actual field is `portfolioKey`, not
 * `key` (every other caller in the codebase gets this right). A query on
 * a field that doesn't exist on any document always matches nothing, so
 * the real portfolio lookup silently failed every single hour and the
 * report always fell back to a hardcoded placeholder ($500 balance, $0
 * change, 0 open trades) -- baked into the stored report and the
 * Telegram/push notification text sent to every user, every hour.
 */
jest.mock('../src/services/notificationService', () => ({
  sendPushToUser: jest.fn(() => Promise.resolve({ success: true })),
  sendTelegramMessage: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../src/jobs/globalScanJob', () => ({
  getCache: jest.fn(() => null),
}));

const Signal = require('../src/models/Signal');
const VirtualPortfolio = require('../src/models/VirtualPortfolio');
const User = require('../src/models/User');
const AIReport = require('../src/models/AIReport');
const { sendPushToUser } = require('../src/services/notificationService');
const { generateHourlyReport, _resetNotifyStateForTests } = require('../src/jobs/hourlyReportJob');

function baseSignal(overrides = {}) {
  return {
    asset: 'BTCUSDT', direction: 'BUY', confidence: 80,
    price: { entry: 65000 }, ...overrides,
  };
}

let CREATED_REPORTS;

beforeEach(() => {
  CREATED_REPORTS = [];
  Signal.find = () => ({
    sort: () => ({ limit: () => ({ lean: async () => [baseSignal()] }) }),
  });
  User.find = () => ({ lean: async () => [] });
  AIReport.create = async (doc) => {
    const saved = { ...doc, _id: 'report1' };
    CREATED_REPORTS.push(saved);
    return saved;
  };
  AIReport.updateOne = async () => ({});
});

describe('hourlyReportJob.generateHourlyReport — portfolio lookup (T-031)', () => {
  test('finds VirtualPortfolio using the real "portfolioKey" field, not "key"', async () => {
    let queriedWith = null;
    VirtualPortfolio.findOne = (query) => {
      queriedWith = query;
      return { lean: async () => ({ portfolioKey: 'global', currentBalance: 1234.56, openTrades: 2, balanceHistory: [] }) };
    };

    await generateHourlyReport();

    expect(queriedWith).toEqual({ portfolioKey: 'global' });
  });

  test('a real portfolio document is picked up instead of the $500 placeholder (regression: T-031)', async () => {
    VirtualPortfolio.findOne = () => ({
      lean: async () => ({
        portfolioKey: 'global',
        currentBalance: 1234.56,
        openTrades: 2,
        balanceHistory: [{ balance: 1200 }, { balance: 1234.56 }],
      }),
    });

    const report = await generateHourlyReport();

    expect(report.portfolioSummary.balance).toBe(1234.56);
    expect(report.portfolioSummary.openTrades).toBe(2);
    expect(report.portfolioSummary.balance).not.toBe(500);
  });

  test('a missing portfolio document (e.g. fresh DB) still falls back safely to the placeholder without crashing', async () => {
    VirtualPortfolio.findOne = () => ({ lean: async () => null });

    const report = await generateHourlyReport();

    expect(report.portfolioSummary).toEqual({ balance: 500, change: 0, changePct: 0, openTrades: 0 });
  });
});

/**
 * Regression suite for T-059 (2026-08-26, product-to-code audit follow-up).
 *
 * Bug: this job pushed a "BRAIN_REPORT" notification to every eligible user
 * every single hour whenever any signal existed in the trailing hour, with
 * no comparison to what was reported the previous hour -- so a user got a
 * fresh push every hour even when the AI's actual recommendation hadn't
 * changed at all.
 *
 * Fix: the AIReport document is still created every hour (a real historical
 * record), but the notification now only fires when the reported
 * asset/action/mood/confidence changed meaningfully since the last time a
 * notification was actually sent.
 */
describe('hourlyReportJob.generateHourlyReport — notification change-gate (T-059)', () => {
  beforeEach(() => {
    _resetNotifyStateForTests();
    sendPushToUser.mockClear();
    VirtualPortfolio.findOne = () => ({ lean: async () => null });
    User.find = () => ({ lean: async () => [{ _id: 'u1', fcmToken: 'tok1', preferences: { fcmEnabled: true } }] });
  });

  test('notifies on the first report ever generated (nothing to compare against)', async () => {
    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal()] }) }) });

    await generateHourlyReport();

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  test('skips the push on the next hour when asset/action/confidence/mood are unchanged', async () => {
    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal()] }) }) });
    await generateHourlyReport(); // first report — notifies, sets _lastNotified
    sendPushToUser.mockClear();

    await generateHourlyReport(); // identical inputs — should NOT notify again

    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  test('still creates the AIReport document even when the notification is skipped', async () => {
    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal()] }) }) });
    await generateHourlyReport();
    sendPushToUser.mockClear();

    const report = await generateHourlyReport();

    expect(report).toBeTruthy();
    expect(report.marketSummary.topAsset).toBe('BTCUSDT');
  });

  test('notifies again when the top action flips (BUY -> SELL)', async () => {
    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal()] }) }) });
    await generateHourlyReport();
    sendPushToUser.mockClear();

    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal({ direction: 'SELL' })] }) }) });
    await generateHourlyReport();

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  test('notifies again when confidence moves by more than the 5pp threshold', async () => {
    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal({ confidence: 80 })] }) }) });
    await generateHourlyReport();
    sendPushToUser.mockClear();

    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal({ confidence: 91 })] }) }) });
    await generateHourlyReport();

    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  test('does NOT notify again for a small confidence wobble under the threshold', async () => {
    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal({ confidence: 80 })] }) }) });
    await generateHourlyReport();
    sendPushToUser.mockClear();

    Signal.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [baseSignal({ confidence: 82 })] }) }) });
    await generateHourlyReport();

    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});
