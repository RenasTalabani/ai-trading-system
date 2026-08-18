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
const { generateHourlyReport } = require('../src/jobs/hourlyReportJob');

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
