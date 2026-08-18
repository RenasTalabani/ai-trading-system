import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/notification_model.dart';

void main() {
  group('NotificationData', () {
    test('fromJson parses all optional fields when present', () {
      final data = NotificationData.fromJson({
        'signalId': 'sig1',
        'asset': 'BTCUSDT',
        'action': 'BUY',
        'confidence': 82.0,
        'price': 60000.0,
      });
      expect(data.signalId, 'sig1');
      expect(data.asset, 'BTCUSDT');
      expect(data.action, 'BUY');
      expect(data.confidence, 82.0);
      expect(data.price, 60000.0);
    });

    test('fromJson leaves every field null on an empty payload (all optional)', () {
      final data = NotificationData.fromJson({});
      expect(data.signalId, isNull);
      expect(data.asset, isNull);
      expect(data.action, isNull);
      expect(data.confidence, isNull);
      expect(data.price, isNull);
    });
  });

  group('NotificationModel', () {
    Map<String, dynamic> baseJson() => {
      '_id': 'n1',
      'type': 'signal',
      'title': 'New BUY signal',
      'body': 'BTCUSDT crossed above EMA200',
      'data': {'asset': 'BTCUSDT', 'action': 'BUY'},
      'createdAt': '2026-08-18T12:00:00.000Z',
    };

    test('fromJson parses a fully-populated unread notification', () {
      final n = NotificationModel.fromJson(baseJson());
      expect(n.id, 'n1');
      expect(n.type, 'signal');
      expect(n.title, 'New BUY signal');
      expect(n.data.asset, 'BTCUSDT');
      expect(n.isRead, isFalse);
      expect(n.isSignal, isTrue);
    });

    test('isRead becomes true once readAt is set', () {
      final n = NotificationModel.fromJson({
        ...baseJson(),
        'readAt': '2026-08-18T13:00:00.000Z',
      });
      expect(n.isRead, isTrue);
    });

    test('isSignal is false for a non-signal notification type', () {
      final n = NotificationModel.fromJson({...baseJson(), 'type': 'system'});
      expect(n.isSignal, isFalse);
    });

    test('fromJson defaults type to "signal" and success/failure counts to 0', () {
      final n = NotificationModel.fromJson({
        '_id': 'n2',
        'title': 't',
        'body': 'b',
        'createdAt': '2026-08-18T00:00:00.000Z',
      });
      expect(n.type, 'signal');
      expect(n.successCount, 0);
      expect(n.failureCount, 0);
      expect(n.data, const NotificationData());
    });
  });
}
