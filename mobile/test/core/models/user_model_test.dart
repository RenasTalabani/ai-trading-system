import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/user_model.dart';

void main() {
  group('UserPreferences', () {
    test('fromJson parses all fields', () {
      final prefs = UserPreferences.fromJson({
        'assets': ['BTCUSDT', 'SOLUSDT'],
        'confidenceThreshold': 85,
        'notificationsEnabled': false,
        'fcmEnabled': false,
        'telegramEnabled': true,
        'maxNotificationsPerHour': 10,
      });
      expect(prefs.assets, ['BTCUSDT', 'SOLUSDT']);
      expect(prefs.confidenceThreshold, 85);
      expect(prefs.notificationsEnabled, isFalse);
      expect(prefs.fcmEnabled, isFalse);
      expect(prefs.telegramEnabled, isTrue);
      expect(prefs.maxNotificationsPerHour, 10);
    });

    test('fromJson applies documented defaults on an empty payload', () {
      final prefs = UserPreferences.fromJson({});
      expect(prefs.assets, ['BTCUSDT', 'ETHUSDT']);
      expect(prefs.confidenceThreshold, 70);
      expect(prefs.notificationsEnabled, isTrue);
      expect(prefs.fcmEnabled, isTrue);
      expect(prefs.telegramEnabled, isFalse);
      expect(prefs.maxNotificationsPerHour, 5);
    });

    test('toJson round-trips back to an equivalent object via fromJson', () {
      const original = UserPreferences(
        assets: ['ETHUSDT'],
        confidenceThreshold: 60,
        notificationsEnabled: false,
        fcmEnabled: true,
        telegramEnabled: true,
        maxNotificationsPerHour: 3,
      );
      final roundTripped = UserPreferences.fromJson(original.toJson());
      expect(roundTripped, original); // relies on Equatable's value equality
    });

    test('copyWith overrides only the specified fields', () {
      const original = UserPreferences();
      final updated = original.copyWith(confidenceThreshold: 90, telegramEnabled: true);

      expect(updated.confidenceThreshold, 90);
      expect(updated.telegramEnabled, isTrue);
      // Untouched fields carry over from the original.
      expect(updated.assets, original.assets);
      expect(updated.notificationsEnabled, original.notificationsEnabled);
      expect(updated.fcmEnabled, original.fcmEnabled);
      expect(updated.maxNotificationsPerHour, original.maxNotificationsPerHour);
    });

    test('copyWith with no arguments returns an equal (unchanged) copy', () {
      const original = UserPreferences(confidenceThreshold: 77);
      expect(original.copyWith(), original);
    });
  });

  group('UserModel', () {
    test('fromJson parses a fully-populated user with nested preferences', () {
      final user = UserModel.fromJson({
        '_id': 'u1',
        'name': 'Renas',
        'email': 'renas@example.com',
        'role': 'premium',
        'isActive': true,
        'fcmToken': 'token123',
        'telegramChatId': '999',
        'preferences': {'confidenceThreshold': 80},
      });

      expect(user.id, 'u1');
      expect(user.name, 'Renas');
      expect(user.email, 'renas@example.com');
      expect(user.role, 'premium');
      expect(user.isActive, isTrue);
      expect(user.fcmToken, 'token123');
      expect(user.telegramChatId, '999');
      expect(user.preferences.confidenceThreshold, 80);
    });

    test('fromJson defaults role to "user" and preferences to defaults when absent', () {
      final user = UserModel.fromJson({'_id': 'u2', 'name': 'X', 'email': 'x@x.com'});
      expect(user.role, 'user');
      expect(user.isActive, isTrue);
      expect(user.fcmToken, isNull);
      expect(user.preferences, const UserPreferences());
    });

    test('isAdmin is true only for the admin role', () {
      final admin = UserModel.fromJson({'_id': 'u', 'name': 'n', 'email': 'e', 'role': 'admin'});
      final user = UserModel.fromJson({'_id': 'u', 'name': 'n', 'email': 'e', 'role': 'user'});
      expect(admin.isAdmin, isTrue);
      expect(user.isAdmin, isFalse);
    });

    test('isPremium is true for both premium and admin roles (admin implies premium access)', () {
      final admin = UserModel.fromJson({'_id': 'u', 'name': 'n', 'email': 'e', 'role': 'admin'});
      final premium = UserModel.fromJson({'_id': 'u', 'name': 'n', 'email': 'e', 'role': 'premium'});
      final user = UserModel.fromJson({'_id': 'u', 'name': 'n', 'email': 'e', 'role': 'user'});
      expect(admin.isPremium, isTrue);
      expect(premium.isPremium, isTrue);
      expect(user.isPremium, isFalse);
    });
  });
}
