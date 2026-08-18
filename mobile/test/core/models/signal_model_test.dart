import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/signal_model.dart';

void main() {
  group('SignalPrice', () {
    test('fromJson parses all fields', () {
      final price = SignalPrice.fromJson({
        'entry': 100.5,
        'stopLoss': 95.0,
        'takeProfit': 110.0,
      });
      expect(price.entry, 100.5);
      expect(price.stopLoss, 95.0);
      expect(price.takeProfit, 110.0);
    });

    test('fromJson defaults entry to 0 and leaves stop/target null when absent', () {
      final price = SignalPrice.fromJson({});
      expect(price.entry, 0);
      expect(price.stopLoss, isNull);
      expect(price.takeProfit, isNull);
    });

    test('riskRewardRatio is null when either level is missing', () {
      expect(SignalPrice.fromJson({'entry': 100}).riskRewardRatio, isNull);
      expect(
        SignalPrice.fromJson({'entry': 100, 'stopLoss': 95}).riskRewardRatio,
        isNull,
      );
    });

    test('riskRewardRatio computes correctly for a BUY-shaped setup', () {
      // entry 100, stop 90 (risk 10), target 130 (reward 30) -> R:R = 3
      final price = SignalPrice.fromJson({
        'entry': 100,
        'stopLoss': 90,
        'takeProfit': 130,
      });
      expect(price.riskRewardRatio, 3.0);
    });

    test('riskRewardRatio is direction-agnostic (works for SELL-shaped levels too)', () {
      // entry 100, stop 110 (above entry, risk 10), target 70 (below entry, reward 30)
      final price = SignalPrice.fromJson({
        'entry': 100,
        'stopLoss': 110,
        'takeProfit': 70,
      });
      expect(price.riskRewardRatio, 3.0);
    });

    test('riskRewardRatio is null when stop equals entry (zero risk, avoids div-by-zero)', () {
      final price = SignalPrice.fromJson({
        'entry': 100,
        'stopLoss': 100,
        'takeProfit': 130,
      });
      expect(price.riskRewardRatio, isNull);
    });
  });

  group('SignalSources', () {
    test('fromJson reads nested market/news/social scores', () {
      final sources = SignalSources.fromJson({
        'market': {'score': 0.8},
        'news': {'score': -0.2},
        'social': {'score': 0.1},
      });
      expect(sources.marketScore, 0.8);
      expect(sources.newsScore, -0.2);
      expect(sources.socialScore, 0.1);
    });

    test('fromJson defaults every score to 0 when the whole object is missing', () {
      final sources = SignalSources.fromJson({});
      expect(sources.marketScore, 0);
      expect(sources.newsScore, 0);
      expect(sources.socialScore, 0);
    });

    test('fromJson defaults an individual score to 0 when only that source is missing', () {
      final sources = SignalSources.fromJson({'market': {'score': 0.5}});
      expect(sources.marketScore, 0.5);
      expect(sources.newsScore, 0);
      expect(sources.socialScore, 0);
    });
  });

  group('SignalModel', () {
    Map<String, dynamic> fullJson() => {
      '_id': 'sig1',
      'asset': 'BTCUSDT',
      'direction': 'BUY',
      'confidence': 82.0,
      'price': {'entry': 60000, 'stopLoss': 58000, 'takeProfit': 66000},
      'reason': 'RSI oversold + bullish news',
      'sources': {
        'market': {'score': 0.7},
        'news': {'score': 0.4},
        'social': {'score': 0.1},
      },
      'status': 'active',
      'createdAt': '2026-08-18T12:00:00.000Z',
    };

    test('fromJson parses a fully-populated signal', () {
      final signal = SignalModel.fromJson(fullJson());
      expect(signal.id, 'sig1');
      expect(signal.asset, 'BTCUSDT');
      expect(signal.direction, 'BUY');
      expect(signal.confidence, 82.0);
      expect(signal.price.entry, 60000);
      expect(signal.reason, 'RSI oversold + bullish news');
      expect(signal.status, 'active');
      expect(signal.createdAt, DateTime.parse('2026-08-18T12:00:00.000Z'));
    });

    test('fromJson falls back to safe defaults on a near-empty payload', () {
      final signal = SignalModel.fromJson({});
      expect(signal.id, '');
      expect(signal.asset, '');
      expect(signal.direction, 'HOLD');
      expect(signal.confidence, 0);
      expect(signal.reason, '');
      expect(signal.status, 'active');
      // createdAt falls back to "now" rather than throwing on an unparsable date.
      expect(signal.createdAt, isA<DateTime>());
    });

    test('isBuy / isSell reflect direction exactly', () {
      final buy = SignalModel.fromJson({...fullJson(), 'direction': 'BUY'});
      final sell = SignalModel.fromJson({...fullJson(), 'direction': 'SELL'});
      final hold = SignalModel.fromJson({...fullJson(), 'direction': 'HOLD'});

      expect(buy.isBuy, isTrue);
      expect(buy.isSell, isFalse);
      expect(sell.isSell, isTrue);
      expect(sell.isBuy, isFalse);
      expect(hold.isBuy, isFalse);
      expect(hold.isSell, isFalse);
    });

    test('confidenceBar renders 10 filled blocks at 100 confidence', () {
      final signal = SignalModel.fromJson({...fullJson(), 'confidence': 100.0});
      expect(signal.confidenceBar, '█' * 10);
    });

    test('confidenceBar renders 0 filled blocks at 0 confidence', () {
      final signal = SignalModel.fromJson({...fullJson(), 'confidence': 0.0});
      expect(signal.confidenceBar, '░' * 10);
    });

    test('confidenceBar rounds to the nearest block for a mid-range value', () {
      // 82 / 10 = 8.2 -> rounds to 8 filled blocks
      final signal = SignalModel.fromJson({...fullJson(), 'confidence': 82.0});
      expect(signal.confidenceBar, '${'█' * 8}${'░' * 2}');
    });

    test('baseAsset strips USDT suffix', () {
      final signal = SignalModel.fromJson({...fullJson(), 'asset': 'ETHUSDT'});
      expect(signal.baseAsset, 'ETH');
    });

    test('baseAsset strips bare USD suffix', () {
      final signal = SignalModel.fromJson({...fullJson(), 'asset': 'XAUUSD'});
      expect(signal.baseAsset, 'XAU');
    });

    test('baseAsset takes the part before a slash for pair-style symbols', () {
      // Must NOT end in USDT/USD, or the earlier endsWith branches win first
      // (e.g. 'BTC/USDT' hits the USDT-suffix branch and becomes 'BTC/',
      // not 'BTC' -- that's the endsWith check applying to the whole
      // string, not a bug in the slash branch below it).
      final signal = SignalModel.fromJson({...fullJson(), 'asset': 'ETH/BTC'});
      expect(signal.baseAsset, 'ETH');
    });

    test('baseAsset returns the symbol unchanged when no known suffix/format matches', () {
      final signal = SignalModel.fromJson({...fullJson(), 'asset': 'XAUEUR'});
      expect(signal.baseAsset, 'XAUEUR');
    });
  });
}
