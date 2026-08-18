import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/order_block_model.dart';

void main() {
  group('OBZone', () {
    test('fromJson parses low/high', () {
      final zone = OBZone.fromJson({'low': 58000, 'high': 60000});
      expect(zone.low, 58000);
      expect(zone.high, 60000);
    });
  });

  group('OrderBlock', () {
    test('fromJson parses a bullish block', () {
      final block = OrderBlock.fromJson({
        'type': 'bullish',
        'zone': {'low': 58000, 'high': 59000},
        'strength': 80,
        'freshness': 'fresh',
        'timeframe': '1h',
        'timestamp': '2026-08-18T00:00:00.000Z',
      });
      expect(block.isBullish, isTrue);
      expect(block.zone.low, 58000);
      expect(block.strength, 80);
    });

    test('isBullish is false for a bearish block', () {
      final block = OrderBlock.fromJson({
        'type': 'bearish',
        'zone': {'low': 61000, 'high': 62000},
        'strength': 60,
        'freshness': 'mitigated',
        'timeframe': '4h',
        'timestamp': '2026-08-18T00:00:00.000Z',
      });
      expect(block.isBullish, isFalse);
    });

    test('fromJson defaults a missing timestamp to an empty string (not a throw)', () {
      final block = OrderBlock.fromJson({
        'type': 'bullish',
        'zone': {'low': 1, 'high': 2},
        'strength': 50,
        'freshness': 'fresh',
        'timeframe': '1h',
      });
      expect(block.timestamp, '');
    });
  });

  group('OBSignal', () {
    test('fromJson maps snake_case backend fields to camelCase properties', () {
      final signal = OBSignal.fromJson({
        'action': 'BUY',
        'confidence': 75,
        'entry_zone': '58000-59000',
        'stop_loss': 57000,
        'take_profit': 63000,
        'risk_reward': '1:4',
        'reason': 'Price entered fresh bullish OB with confluence',
      });
      expect(signal.action, 'BUY');
      expect(signal.confidence, 75);
      expect(signal.entryZone, '58000-59000');
      expect(signal.stopLoss, 57000);
      expect(signal.riskReward, '1:4');
    });

    test('fromJson leaves optional trade-plan fields null when absent', () {
      final signal = OBSignal.fromJson({'action': 'HOLD', 'confidence': 40, 'reason': ''});
      expect(signal.entryZone, isNull);
      expect(signal.stopLoss, isNull);
      expect(signal.takeProfit, isNull);
      expect(signal.riskReward, isNull);
    });
  });

  group('OBNewsAnalysis', () {
    test('fromJson maps snake_case fields with neutral-scale defaults', () {
      final analysis = OBNewsAnalysis.fromJson({});
      expect(analysis.newsScore, 50);
      expect(analysis.socialScore, 50);
      expect(analysis.sentiment, 'neutral');
      expect(analysis.topEvents, isEmpty);
      expect(analysis.aligned, isFalse);
    });

    test('fromJson parses a fully-populated analysis', () {
      final analysis = OBNewsAnalysis.fromJson({
        'news_score': 80,
        'social_score': 70,
        'combined_score': 75,
        'sentiment': 'bullish',
        'impact': 0.6,
        'article_count': 12,
        'top_events': ['ETF approval rumor'],
        'aligned': true,
        'confidence_boost': 10,
        'technical_confidence': 65,
      });
      expect(analysis.sentiment, 'bullish');
      expect(analysis.articleCount, 12);
      expect(analysis.topEvents, ['ETF approval rumor']);
      expect(analysis.aligned, isTrue);
      expect(analysis.confidenceBoost, 10);
    });

    test('empty constant matches the documented neutral defaults', () {
      expect(OBNewsAnalysis.empty.sentiment, 'neutral');
      expect(OBNewsAnalysis.empty.newsScore, 50);
      expect(OBNewsAnalysis.empty.aligned, isFalse);
    });
  });

  group('OrderBlockResult', () {
    Map<String, dynamic> fullJson() => {
      'asset': 'BTCUSDT',
      'timeframe': '1h',
      'current_price': 60000,
      'ema50': 59500,
      'ema200': 58000,
      'rsi': 55,
      'trend': 'uptrend',
      'order_blocks': [
        {
          'type': 'bullish',
          'zone': {'low': 58000, 'high': 59000},
          'strength': 80,
          'freshness': 'fresh',
          'timeframe': '1h',
          'timestamp': '2026-08-18T00:00:00.000Z',
        },
      ],
      'signal': {'action': 'BUY', 'confidence': 75, 'reason': 'test'},
    };

    test('fromJson parses a full result with nested order blocks and signal', () {
      final result = OrderBlockResult.fromJson(fullJson());
      expect(result.asset, 'BTCUSDT');
      expect(result.orderBlocks.length, 1);
      expect(result.orderBlocks.first.isBullish, isTrue);
      expect(result.signal.action, 'BUY');
      // news_analysis wasn't in the payload -> falls back to the empty constant.
      expect(result.newsAnalysis, OBNewsAnalysis.empty);
    });

    test('fromJson parses an attached news_analysis block when present', () {
      final result = OrderBlockResult.fromJson({
        ...fullJson(),
        'news_analysis': {'sentiment': 'bearish', 'news_score': 20},
      });
      expect(result.newsAnalysis.sentiment, 'bearish');
      expect(result.newsAnalysis.newsScore, 20);
    });

    test('fromJson throws when a required top-level field is missing (no defaulting, by design)', () {
      // Consumed via OrderBlockNotifier (AsyncNotifier) -- a thrown error
      // here becomes a normal AsyncValue.error state for the UI, the same
      // deliberate "strict model, framework-level error handling" pattern
      // used by PnLModel. Documented so it isn't mistaken for an oversight.
      final broken = fullJson()..remove('rsi');
      expect(() => OrderBlockResult.fromJson(broken), throwsA(isA<TypeError>()));
    });
  });
}
