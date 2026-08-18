import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/virtual_portfolio_model.dart';

void main() {
  group('BalancePoint', () {
    test('fromJson parses date and balance', () {
      final point = BalancePoint.fromJson({
        'date': '2026-08-01T00:00:00.000Z',
        'balance': 512.34,
      });
      expect(point.date, DateTime.parse('2026-08-01T00:00:00.000Z'));
      expect(point.balance, 512.34);
    });

    test('fromJson defaults balance to 0 when missing', () {
      final point = BalancePoint.fromJson({'date': '2026-08-01T00:00:00.000Z'});
      expect(point.balance, 0);
    });
  });

  group('TradeSnapshot', () {
    test('fromJson parses a closed trade snapshot', () {
      final snap = TradeSnapshot.fromJson({
        'pnl': 42.5,
        'asset': 'BTCUSDT',
        'direction': 'BUY',
        'closedAt': '2026-08-10T10:00:00.000Z',
      });
      expect(snap.pnl, 42.5);
      expect(snap.asset, 'BTCUSDT');
      expect(snap.direction, 'BUY');
      expect(snap.closedAt, DateTime.parse('2026-08-10T10:00:00.000Z'));
    });

    test('fromJson leaves closedAt null when absent (still-open trade snapshot)', () {
      final snap = TradeSnapshot.fromJson({'pnl': -10, 'asset': 'ETHUSDT', 'direction': 'SELL'});
      expect(snap.closedAt, isNull);
    });
  });

  group('VirtualPerformanceModel', () {
    test('fromJson parses a fully-populated performance payload', () {
      final perf = VirtualPerformanceModel.fromJson({
        'startingBalance': 500,
        'currentBalance': 650,
        'riskPerTradePct': 5,
        'netProfit': 150,
        'netProfitPct': 30,
        'totalProfit': 200,
        'totalLoss': 50,
        'winCount': 8,
        'lossCount': 2,
        'totalTrades': 10,
        'openTrades': 1,
        'winRate': 80,
        'avgDurationMinutes': 45,
        'maxDrawdown': 12.5,
        'peakBalance': 680,
        'bestTrade': {'pnl': 60, 'asset': 'BTCUSDT', 'direction': 'BUY'},
        'worstTrade': {'pnl': -20, 'asset': 'ETHUSDT', 'direction': 'SELL'},
        'balanceHistory': [
          {'date': '2026-08-01T00:00:00.000Z', 'balance': 500},
          {'date': '2026-08-10T00:00:00.000Z', 'balance': 650},
        ],
        'range': '30d',
      });

      expect(perf.currentBalance, 650);
      expect(perf.netProfit, 150);
      expect(perf.winCount, 8);
      expect(perf.bestTrade?.pnl, 60);
      expect(perf.worstTrade?.pnl, -20);
      expect(perf.balanceHistory.length, 2);
      expect(perf.range, '30d');
    });

    test('fromJson defaults to a fresh \$500 portfolio on an empty payload', () {
      final perf = VirtualPerformanceModel.fromJson({});
      expect(perf.startingBalance, 500);
      expect(perf.currentBalance, 500);
      expect(perf.netProfit, 0);
      expect(perf.totalTrades, 0);
      expect(perf.bestTrade, isNull);
      expect(perf.worstTrade, isNull);
      expect(perf.balanceHistory, isEmpty);
      expect(perf.range, 'all');
    });

    test('isProfitable is true at exactly break-even (>= 0, not > 0)', () {
      final perf = VirtualPerformanceModel.fromJson({'netProfit': 0});
      expect(perf.isProfitable, isTrue);
    });

    test('isProfitable is false when net profit is negative', () {
      final perf = VirtualPerformanceModel.fromJson({'netProfit': -1});
      expect(perf.isProfitable, isFalse);
    });

    test('returnPct computes profit as a percentage of starting balance', () {
      final perf = VirtualPerformanceModel.fromJson({
        'startingBalance': 500,
        'netProfit': 100,
      });
      expect(perf.returnPct, 20.0);
    });

    test('returnPct is 0 (not NaN/infinite) when startingBalance is 0', () {
      final perf = VirtualPerformanceModel.fromJson({
        'startingBalance': 0,
        'netProfit': 100,
      });
      expect(perf.returnPct, 0);
    });
  });

  group('VirtualTradeModel', () {
    Map<String, dynamic> baseJson() => {
      '_id': 't1',
      'signalId': 'sig1',
      'asset': 'BTCUSDT',
      'direction': 'BUY',
      'entryPrice': 60000,
      'sizeUsd': 100,
      'status': 'open',
      'openedAt': '2026-08-18T00:00:00.000Z',
    };

    test('fromJson parses a fully-populated futures trade', () {
      final trade = VirtualTradeModel.fromJson({
        ...baseJson(),
        'status': 'closed_profit',
        'result': 'win',
        'exitReason': 'TAKE_PROFIT',
        'exitPrice': 63000,
        'pnl': 150,
        'pnlPct': 5,
        'durationMinutes': 120,
        'closedAt': '2026-08-18T02:00:00.000Z',
        'productType': 'futures',
        'leverage': 5,
        'marginUsd': 20,
        'liquidationPrice': 54000,
        'fundingPaid': 0.5,
        'trailingStopEnabled': true,
      });

      expect(trade.id, 't1');
      expect(trade.isOpen, isFalse);
      expect(trade.isWin, isTrue);
      expect(trade.isLoss, isFalse);
      expect(trade.isFutures, isTrue);
      expect(trade.isLiquidated, isFalse);
      expect(trade.leverage, 5);
      expect(trade.trailingStopEnabled, isTrue);
    });

    test('fromJson applies spot/leverage-1 defaults when futures fields are absent', () {
      final trade = VirtualTradeModel.fromJson(baseJson());
      expect(trade.productType, 'spot');
      expect(trade.leverage, 1);
      expect(trade.isFutures, isFalse);
      expect(trade.marginUsd, isNull);
      expect(trade.fundingPaid, 0);
      expect(trade.trailingStopEnabled, isFalse);
    });

    test('isLiquidated is true only when exitReason is exactly LIQUIDATED', () {
      final liquidated = VirtualTradeModel.fromJson({
        ...baseJson(),
        'exitReason': 'LIQUIDATED',
      });
      final stopped = VirtualTradeModel.fromJson({
        ...baseJson(),
        'exitReason': 'STOP_LOSS',
      });
      expect(liquidated.isLiquidated, isTrue);
      expect(stopped.isLiquidated, isFalse);
    });

    test('baseAsset strips USDT suffix', () {
      final trade = VirtualTradeModel.fromJson({...baseJson(), 'asset': 'SOLUSDT'});
      expect(trade.baseAsset, 'SOL');
    });

    test('durationLabel formats sub-hour durations as minutes only', () {
      final trade = VirtualTradeModel.fromJson({...baseJson(), 'durationMinutes': 45});
      expect(trade.durationLabel, '45m');
    });

    test('durationLabel formats exact-hour durations without a minutes part', () {
      final trade = VirtualTradeModel.fromJson({...baseJson(), 'durationMinutes': 120});
      expect(trade.durationLabel, '2h');
    });

    test('durationLabel formats mixed hour+minute durations', () {
      final trade = VirtualTradeModel.fromJson({...baseJson(), 'durationMinutes': 125});
      expect(trade.durationLabel, '2h 5m');
    });

    test('durationLabel is empty when duration is unknown (still-open trade)', () {
      final trade = VirtualTradeModel.fromJson(baseJson());
      expect(trade.durationLabel, '');
    });
  });
}
