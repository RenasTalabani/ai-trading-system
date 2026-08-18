import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/backtest_model.dart';

void main() {
  group('BacktestResultModel', () {
    test('fromJson parses all fields (snake_case backend keys)', () {
      final result = BacktestResultModel.fromJson({
        'asset': 'BTCUSDT',
        'interval': '4h',
        'period_start': '2026-01-01T00:00:00.000Z',
        'period_end': '2026-08-01T00:00:00.000Z',
        'total_trades': 40,
        'wins': 28,
        'losses': 12,
        'win_rate': 70.0,
        'total_return_pct': 35.5,
        'profit_factor': 2.1,
        'max_drawdown_pct': 12.0,
        'sharpe_ratio': 1.8,
        'avg_win_pct': 4.2,
        'avg_loss_pct': -2.1,
        'total_pnl_usd': 177.5,
      });

      expect(result.asset, 'BTCUSDT');
      expect(result.periodStart, DateTime.parse('2026-01-01T00:00:00.000Z'));
      expect(result.totalTrades, 40);
      expect(result.wins, 28);
      expect(result.winRate, 70.0);
      expect(result.sharpeRatio, 1.8);
    });

    test('fromJson defaults interval to 1h and all numerics to 0 when absent', () {
      final result = BacktestResultModel.fromJson({});
      expect(result.asset, '');
      expect(result.interval, '1h');
      expect(result.totalTrades, 0);
      expect(result.winRate, 0);
      expect(result.totalReturnPct, 0);
      // Unparsable/missing dates fall back to "now" rather than throwing.
      expect(result.periodStart, isA<DateTime>());
    });

    test('isProfitable is true at exactly 0% return (>= 0, not > 0)', () {
      final result = BacktestResultModel.fromJson({'total_return_pct': 0});
      expect(result.isProfitable, isTrue);
    });

    test('isProfitable is false for a negative return', () {
      final result = BacktestResultModel.fromJson({'total_return_pct': -5});
      expect(result.isProfitable, isFalse);
    });
  });
}
