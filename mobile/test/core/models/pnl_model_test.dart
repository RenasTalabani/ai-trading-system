import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/pnl_model.dart';

void main() {
  group('PnLModel', () {
    test('fromJson parses all fields', () {
      final pnl = PnLModel.fromJson({
        'profit': 120.5,
        'loss': -30.25,
        'net': 90.25,
        'winRate': 66.7,
        'trades': 12,
      });
      expect(pnl.profit, 120.5);
      expect(pnl.loss, -30.25);
      expect(pnl.net, 90.25);
      expect(pnl.winRate, 66.7);
      expect(pnl.trades, 12);
    });

    test('fromJson accepts integer JSON values for double fields (toDouble conversion)', () {
      // Node/JSON can send whole numbers without a decimal point; this
      // model does NOT default missing fields, so it must at least
      // tolerate int-vs-double across the wire without throwing.
      final pnl = PnLModel.fromJson({
        'profit': 100,
        'loss': 0,
        'net': 100,
        'winRate': 50,
        'trades': 5,
      });
      expect(pnl.profit, 100.0);
      expect(pnl.trades, 5);
    });

    test('fromJson throws when a required field is missing (no defaulting, by design)', () {
      // Unlike most other models in this codebase, PnLModel.fromJson has no
      // `?? 0` fallback -- it's consumed via an AsyncNotifier (see
      // pnl_provider.dart), so a thrown error here becomes a normal
      // AsyncValue.error state for the UI to handle, not an app crash.
      // PnLModel.empty exists as the deliberate manual fallback constant.
      expect(() => PnLModel.fromJson({'profit': 1, 'loss': 0, 'net': 1, 'winRate': 0}),
          throwsA(isA<TypeError>()));
    });

    test('empty constant is all-zero', () {
      expect(PnLModel.empty.profit, 0);
      expect(PnLModel.empty.loss, 0);
      expect(PnLModel.empty.net, 0);
      expect(PnLModel.empty.winRate, 0);
      expect(PnLModel.empty.trades, 0);
    });
  });
}
