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
  static final _fcm              = FirebaseMessaging.instance;
  static final _localNotifications = FlutterLocalNotificationsPlugin();

  // Set by main.dart after router is ready; used to navigate on tap
  static void Function(String route)? onNavigate;

  static const _androidChannel = AndroidNotificationChannel(
    'trading_signals',
    'Trading Signals',
    description: 'Real-time AI trading signal notifications',
    importance: Importance.max,
    playSound: true,
    enableVibration: true,
  );

  static String _routeForMessage(RemoteMessage msg) {
    final type = msg.data['type'] as String? ?? '';
    if (type == 'PRICE_ALERT') return '/notifications';
    return '/'; // brain screen for all other types
  }

  static Future<void> init() async {
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    // Request permission
    final settings = await _fcm.requestPermission(
      alert: true, badge: true, sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) return;

    // Local notifications setup (for foreground display)
    await _localNotifications.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS:     DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (details) {
        // Foreground local notification tapped
        final payload = details.payload ?? '';
        if (payload == 'PRICE_ALERT') {
          onNavigate?.call('/notifications');
        } else {
          onNavigate?.call('/');
        }
      },
    );

    await _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_androidChannel);

    // Foreground message — show local notification
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification == null) return;
      final type = message.data['type'] as String? ?? '';
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
        payload: type,
      );
    });

    // Background tap (app was in background, user tapped notification)
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      onNavigate?.call(_routeForMessage(message));
    });

    // Terminated tap (app was closed, user tapped notification)
    final initial = await _fcm.getInitialMessage();
    if (initial != null) {
      // Delay slightly so the router is ready before navigating
      Future.delayed(const Duration(milliseconds: 500), () {
        onNavigate?.call(_routeForMessage(initial));
      });
    }

    // Register token
    await registerToken();
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
    } on DioException catch (_) {}
  }

  static Future<void> deleteToken() async {
    try {
      await _fcm.deleteToken();
      await ApiService.dio.delete(ApiConstants.registerToken);
    } catch (_) {}
  }
}
