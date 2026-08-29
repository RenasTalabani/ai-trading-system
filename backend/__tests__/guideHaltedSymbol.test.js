/**
 * Regression suite for BUG-003 (2026-08-29 overnight validation report).
 *
 * MATICUSDT's paper position was confirmed frozen at exactly its entry
 * price / 0% P&L for 19+ consecutive days -- getPositions() silently fell
 * back to trade.entryPrice whenever a tracked asset had no cached live
 * price, indistinguishable from a genuinely unchanged position. Fixed to
 * check the real exchange status (binanceService.getSymbolStatus()) for
 * that specific gap and surface an explicit "halted" state instead of a
 * guessed 0% P&L; sellNow() now allows closing a confirmed-halted position
 * at its last-known price instead of blocking indefinitely with a
 * "try again shortly" message that would never resolve.
 */
jest.mock('../src/services/binanceService', () => ({
  getAllCachedPrices: jest.fn(),
  getSymbolStatus: jest.fn(),
  TRACKED_ASSETS: ['BTCUSDT', 'ETHUSDT', 'MATICUSDT', 'ADAUSDT'],
}));
jest.mock('../src/services/virtualTrackingService', () => ({
  approveSuggestion: jest.fn(),
  previewSizeUsd: jest.fn(),
  getSummary: jest.fn(async () => ({ currentBalance: 500 })),
  closePositionNow: jest.fn(async (tradeId, price, exitReason) => ({
    asset: 'MATICUSDT', direction: 'BUY', pnl: 0, pnlPct: 0,
    result: 'loss', exitPrice: price, exitReason,
  })),
}));
jest.mock('../src/services/aiService', () => ({ getPrice: jest.fn(async () => null) }));

const { getAllCachedPrices, getSymbolStatus } = require('../src/services/binanceService');
const { closePositionNow } = require('../src/services/virtualTrackingService');
const VirtualTrade = require('../src/models/VirtualTrade');
const Signal        = require('../src/models/Signal');
const guideController = require('../src/controllers/guideController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  Signal.find = () => ({ sort: () => Promise.resolve([]) });
});

describe('getPositions — halted-symbol detection (BUG-003)', () => {
  test('a tracked asset with no cached price and a confirmed exchange halt is marked isHalted, not silently priced at entry', async () => {
    const trade = {
      _id: 't1', asset: 'MATICUSDT', direction: 'BUY', sizeUsd: 25,
      entryPrice: 0.3794, stopLoss: 0.37, takeProfit: 0.39, openedAt: new Date(),
    };
    VirtualTrade.find = () => ({ sort: () => Promise.resolve([trade]) });
    getAllCachedPrices.mockReturnValue({}); // MATICUSDT genuinely absent from cache
    getSymbolStatus.mockResolvedValue('BREAK');

    const res = mockRes();
    await guideController.getPositions({}, res);

    const body = res.json.mock.calls[0][0];
    expect(body.positions[0].isHalted).toBe(true);
    expect(body.positions[0].currentPrice).toBeNull();
    expect(body.positions[0].pnlPct).toBeNull();
    // A halted position's undefined risk/gain must not be silently
    // counted as zero in the always-on risk/gain totals.
    expect(body.positionsWithoutStopLoss).toBe(1);
    expect(body.positionsWithoutTakeProfit).toBe(1);
  });

  test('a tracked asset with no cached price but a confirmed TRADING status falls back to entry price as before (transient gap, not a halt)', async () => {
    const trade = {
      _id: 't2', asset: 'BTCUSDT', direction: 'BUY', sizeUsd: 25,
      entryPrice: 65000, stopLoss: 64000, takeProfit: 67000, openedAt: new Date(),
    };
    VirtualTrade.find = () => ({ sort: () => Promise.resolve([trade]) });
    getAllCachedPrices.mockReturnValue({}); // cache just hasn't populated yet
    getSymbolStatus.mockResolvedValue('TRADING');

    const res = mockRes();
    await guideController.getPositions({}, res);

    const body = res.json.mock.calls[0][0];
    expect(body.positions[0].isHalted).toBe(false);
    expect(body.positions[0].currentPrice).toBe(65000); // entryPrice fallback preserved
  });

  test('a normal position with a cached price never triggers a symbol-status check at all', async () => {
    const trade = {
      _id: 't3', asset: 'ETHUSDT', direction: 'BUY', sizeUsd: 25,
      entryPrice: 2400, stopLoss: 2300, takeProfit: 2600, openedAt: new Date(),
    };
    VirtualTrade.find = () => ({ sort: () => Promise.resolve([trade]) });
    getAllCachedPrices.mockReturnValue({ ETHUSDT: { price: 2450 } });

    const res = mockRes();
    await guideController.getPositions({}, res);

    expect(getSymbolStatus).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.positions[0].currentPrice).toBe(2450);
    expect(body.positions[0].isHalted).toBe(false);
  });
});

describe('sellNow — closing a halted position (BUG-003)', () => {
  test('a confirmed-halted asset with no live price is closed at its last-known (entry) price, not blocked', async () => {
    const trade = { _id: 't1', asset: 'MATICUSDT', entryPrice: 0.3794, direction: 'BUY' };
    VirtualTrade.findById = () => Promise.resolve(trade);
    getAllCachedPrices.mockReturnValue({});
    getSymbolStatus.mockResolvedValue('BREAK');

    const res = mockRes();
    await guideController.sellNow({ params: { tradeId: 't1' } }, res);

    expect(closePositionNow).toHaveBeenCalledWith('t1', 0.3794, 'HALTED');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(409);
  });

  test('a transient no-price gap (not a confirmed halt) is still blocked with the original message', async () => {
    const trade = { _id: 't2', asset: 'BTCUSDT', entryPrice: 65000, direction: 'BUY' };
    VirtualTrade.findById = () => Promise.resolve(trade);
    getAllCachedPrices.mockReturnValue({});
    getSymbolStatus.mockResolvedValue('TRADING');

    const res = mockRes();
    await guideController.sellNow({ params: { tradeId: 't2' } }, res);

    expect(closePositionNow).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
