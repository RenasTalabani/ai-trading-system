import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:dio/dio.dart';
import '../constants/api_constants.dart';
import 'api_service.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Background message handling — Firebase handles display automatically
}

class PushNotificationService {
  static final _fcm = FirebaseMessaging.instance;
  static final _localNotifications = FlutterLocalNotificationsPlugin();

  static const _androidChannel = AndroidNotificationChannel(
    'trading_signals',
    'Trading Signals',
    description: 'Real-time AI trading signal notifications',
    importance: Importance.max,
    playSound: true,
    enableVibration: true,
  );

  static Future<void> init() async {
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    // Request permission
    final settings = await _fcm.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );

    if (settings.authorizationStatus == AuthorizationStatus.denied) return;

    // Local notifications setup (for foreground display)
    const initSettingsAndroid = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettingsIOS = DarwinInitializationSettings();
    await _localNotifications.initialize(
      const InitializationSettings(
        android: initSettingsAndroid,
        iOS:     initSettingsIOS,
      ),
    );

    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_androidChannel);

    // Foreground message handler
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification == null) return;

      _localNotifications.show(
        notification.hashCode,
        notification.title,
        notification.body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _androidChannel.id,
            _androidChannel.name,
            channelDescription: _androidChannel.description,
            importance: Importance.max,
            priority:   Priority.high,
          ),
          iOS: const DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
          ),
        ),
      );
    });

    // Register token
    await registerToken();

    // Refresh token handler
    _fcm.onTokenRefresh.listen((_) => registerToken());
  }

  static Future<void> registerToken() async {
    try {
      final token = await _fcm.getToken();
      if (token == null) return;
      await ApiService.dio.post(
        ApiConstants.registerToken,
        data: {'token': token},
      );
    } on DioException catch (_) {
      // Token registration is best-effort
    }
  }

  static Future<void> deleteToken() async {
    try {
      await _fcm.deleteToken();
      await ApiService.dio.delete(ApiConstants.registerToken);
    } catch (_) {}
  }
}
