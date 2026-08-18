import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/strategy_model.dart';

void main() {
  group('AssetRecommendation', () {
    test('fromJson parses snake_case backend fields', () {
      final rec = AssetRecommendation.fromJson({
        'asset': 'BTCUSDT',
        'recommendation': 'BUY',
        'trend': 'up',
        'confidence': 80,
        'expected_move_percent': 5.5,
        'current_price': 60000.0,
        'reason': 'Strong momentum',
      });
      expect(rec.asset, 'BTCUSDT');
      expect(rec.recommendation, 'BUY');
      expect(rec.expectedMovePercent, 5.5);
      expect(rec.currentPrice, 60000.0);
    });

    test('fromJson also accepts the camelCase field-name variants', () {
      // fromJson explicitly falls back to expectedMove/currentPrice if the
      // snake_case keys are absent -- both wire formats are supported.
      final rec = AssetRecommendation.fromJson({
        'asset': 'ETHUSDT',
        'expectedMove': 3.2,
        'currentPrice': 3000.0,
      });
      expect(rec.expectedMovePercent, 3.2);
      expect(rec.currentPrice, 3000.0);
    });

    test('snake_case takes precedence over camelCase when both are present', () {
      final rec = AssetRecommendation.fromJson({
        'asset': 'ETHUSDT',
        'expected_move_percent': 9.0,
        'expectedMove': 1.0,
      });
      expect(rec.expectedMovePercent, 9.0);
    });

    test('fromJson defaults recommendation to HOLD, confidence to 50, trend to unknown', () {
      final rec = AssetRecommendation.fromJson({});
      expect(rec.recommendation, 'HOLD');
      expect(rec.confidence, 50);
      expect(rec.trend, 'unknown');
      expect(rec.reason, '');
    });

    test('fromJson leaves simulation-extra fields null when this is a plain recommendation', () {
      final rec = AssetRecommendation.fromJson({'asset': 'BTCUSDT'});
      expect(rec.initialCapital, isNull);
      expect(rec.finalBalance, isNull);
      expect(rec.profit, isNull);
      expect(rec.trades, isNull);
    });

    test('baseAsset strips a USDT suffix', () {
      final rec = AssetRecommendation.fromJson({'asset': 'SOLUSDT'});
      expect(rec.baseAsset, 'SOL');
    });

    test('baseAsset returns non-USDT symbols unchanged (no USD/slash handling here)', () {
      final rec = AssetRecommendation.fromJson({'asset': 'XAUUSD'});
      expect(rec.baseAsset, 'XAUUSD');
    });
  });

  group('HoldingResult', () {
    test('fromJson parses recommendations list and top-level fields', () {
      final result = HoldingResult.fromJson({
        'best_asset': 'BTCUSDT',
        'best_rec': 'BUY',
        'recommendations': [
          {'asset': 'BTCUSDT', 'recommendation': 'BUY'},
          {'asset': 'ETHUSDT', 'recommendation': 'HOLD'},
        ],
        'expected_profit': 100,
        'expected_loss': 20,
        'win_rate': 65,
        'capital': 1000,
        'timeframe': '30d',
      });
      expect(result.bestAsset, 'BTCUSDT');
      expect(result.recommendations.length, 2);
      expect(result.capital, 1000);
      expect(result.timeframe, '30d');
    });

    test('fromJson defaults capital to 500 and timeframe to 7d when absent', () {
      final result = HoldingResult.fromJson({});
      expect(result.bestAsset, isNull);
      expect(result.recommendations, isEmpty);
      expect(result.capital, 500);
      expect(result.timeframe, '7d');
    });
  });

  group('SimulationResult', () {
    test('fromJson parses a full simulation payload including perAsset breakdown', () {
      final result = SimulationResult.fromJson({
        'initial_balance': 500,
        'final_balance': 650,
        'profit': 200,
        'loss': -50,
        'net_pnl': 150,
        'return_pct': 30,
        'win_rate': 70,
        'total_trades': 10,
        'timeframe': '30d',
        'per_asset': [
          {'asset': 'BTCUSDT', 'profit': 100},
        ],
      });
      expect(result.finalBalance, 650);
      expect(result.netPnl, 150);
      expect(result.perAsset.length, 1);
      expect(result.perAsset.first.asset, 'BTCUSDT');
    });

    test('fromJson defaults balances to 500 and empty perAsset when absent', () {
      final result = SimulationResult.fromJson({});
      expect(result.initialBalance, 500);
      expect(result.finalBalance, 500);
      expect(result.perAsset, isEmpty);
    });

    test('isProfitable is true at exactly break-even net P&L', () {
      final result = SimulationResult.fromJson({'net_pnl': 0});
      expect(result.isProfitable, isTrue);
    });

    test('isProfitable is false for a negative net P&L', () {
      final result = SimulationResult.fromJson({'net_pnl': -1});
      expect(result.isProfitable, isFalse);
    });
  });
}
