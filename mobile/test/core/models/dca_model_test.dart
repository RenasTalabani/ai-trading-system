import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/dca_model.dart';

void main() {
  group('DCAPurchase', () {
    test('fromJson parses a purchase record', () {
      final purchase = DCAPurchase.fromJson({
        'price': 60000,
        'amountUsd': 50,
        'units': 0.000833,
        'date': '2026-08-01T00:00:00.000Z',
      });
      expect(purchase.price, 60000);
      expect(purchase.amountUsd, 50);
      expect(purchase.units, 0.000833);
      expect(purchase.date, DateTime.parse('2026-08-01T00:00:00.000Z'));
    });

    test('fromJson defaults numeric fields to 0 when missing', () {
      final purchase = DCAPurchase.fromJson({});
      expect(purchase.price, 0);
      expect(purchase.amountUsd, 0);
      expect(purchase.units, 0);
    });
  });

  group('DCAPlanModel', () {
    Map<String, dynamic> baseJson() => {
      '_id': 'plan1',
      'asset': 'BTCUSDT',
      'amountPerBuy': 50,
      'frequencyDays': 7,
      'status': 'active',
      'totalInvested': 200,
      'totalUnits': 0.0033,
      'startedAt': '2026-07-01T00:00:00.000Z',
      'avgCostBasis': 60000,
    };

    test('fromJson parses a plan with purchase history and live P&L', () {
      final plan = DCAPlanModel.fromJson({
        ...baseJson(),
        'purchases': [
          {'price': 60000, 'amountUsd': 50, 'units': 0.000833, 'date': '2026-07-01T00:00:00.000Z'},
          {'price': 62000, 'amountUsd': 50, 'units': 0.000806, 'date': '2026-07-08T00:00:00.000Z'},
        ],
        'lastBuyAt': '2026-07-08T00:00:00.000Z',
        'currentPrice': 65000,
        'currentValue': 215,
        'unrealizedPnl': 15,
        'unrealizedPnlPct': 7.5,
      });

      expect(plan.id, 'plan1');
      expect(plan.purchases.length, 2);
      expect(plan.lastBuyAt, DateTime.parse('2026-07-08T00:00:00.000Z'));
      expect(plan.currentPrice, 65000);
      expect(plan.unrealizedPnl, 15);
    });

    test('fromJson defaults optional live-P&L fields to null and purchases to empty', () {
      final plan = DCAPlanModel.fromJson(baseJson());
      expect(plan.purchases, isEmpty);
      expect(plan.lastBuyAt, isNull);
      expect(plan.currentPrice, isNull);
      expect(plan.currentValue, isNull);
      expect(plan.unrealizedPnl, isNull);
      expect(plan.unrealizedPnlPct, isNull);
    });

    test('fromJson defaults status to active and frequencyDays to 1 when absent', () {
      final plan = DCAPlanModel.fromJson({
        '_id': 'plan2',
        'asset': 'ETHUSDT',
        'amountPerBuy': 25,
        'totalInvested': 0,
        'totalUnits': 0,
        'startedAt': '2026-08-01T00:00:00.000Z',
        'avgCostBasis': 0,
      });
      expect(plan.status, 'active');
      expect(plan.frequencyDays, 1);
    });

    test('isActive reflects the status field exactly', () {
      final active   = DCAPlanModel.fromJson({...baseJson(), 'status': 'active'});
      final paused   = DCAPlanModel.fromJson({...baseJson(), 'status': 'stopped'});
      expect(active.isActive, isTrue);
      expect(paused.isActive, isFalse);
    });
  });
}
