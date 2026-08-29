/**
 * Regression suite for BUG-003 (2026-08-29 overnight validation report).
 *
 * MATICUSDT's paper position was confirmed frozen at exactly its entry
 * price / 0% P&L for 19+ consecutive days -- Binance put the symbol under
 * trading status "BREAK" (the MATIC->POL migration), so it never appears
 * in the live price cache and the app had no way to tell "genuinely
 * halted" apart from "price just isn't cached right now". getSymbolStatus()
 * queries Binance's real exchangeInfo endpoint (the same one used to
 * diagnose the MATICUSDT case) so callers can make that distinction
 * instead of guessing from an absent cache entry alone.
 *
 * Each test uses its own symbol name -- getSymbolStatus() caches per-symbol
 * for an hour, and this is the real module singleton (not re-required per
 * test), so reusing a symbol across tests would leak cache state between
 * them.
 */
const axios = require('axios');
jest.mock('axios');

const { getSymbolStatus } = require('../src/services/binanceService');

beforeEach(() => {
  axios.get.mockReset();
});

describe('binanceService.getSymbolStatus (BUG-003)', () => {
  test('returns the real status for a halted symbol (matches the live MATICUSDT finding)', async () => {
    axios.get.mockResolvedValue({ data: { symbols: [{ symbol: 'MATICUSDT', status: 'BREAK' }] } });

    const status = await getSymbolStatus('MATICUSDT');

    expect(status).toBe('BREAK');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/v3/exchangeInfo'),
      expect.objectContaining({ params: { symbol: 'MATICUSDT' } }),
    );
  });

  test('returns TRADING for a normally-trading symbol', async () => {
    axios.get.mockResolvedValue({ data: { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING' }] } });

    const status = await getSymbolStatus('BTCUSDT');

    expect(status).toBe('TRADING');
  });

  test('a second call for the same symbol within the cache TTL does not hit the network again', async () => {
    axios.get.mockResolvedValue({ data: { symbols: [{ symbol: 'DOGEUSDT', status: 'TRADING' }] } });

    await getSymbolStatus('DOGEUSDT');
    await getSymbolStatus('DOGEUSDT');

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('a transient API failure returns null (not "halted") so a network blip cannot masquerade as a real exchange halt', async () => {
    axios.get.mockRejectedValue(new Error('network blip'));

    const status = await getSymbolStatus('AVAXUSDT');

    expect(status).toBeNull();
  });
});
