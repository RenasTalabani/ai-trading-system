class ApiConstants {
  static const String _base = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:5000', // Android emulator → localhost
  );

  static const String baseUrl  = _base;
  static const String apiV1    = '$_base/api/v1';

  // Auth
  static const String register     = '$apiV1/auth/register';
  static const String login        = '$apiV1/auth/login';
  static const String me           = '$apiV1/auth/me';
  static const String fcmToken     = '$apiV1/auth/fcm-token';

  // Signals
  static const String signals      = '$apiV1/signals';
  static const String signalStats  = '$apiV1/signals/stats';

  // Market
  static const String livePrices   = '$apiV1/market/prices/live';
  static const String assets       = '$apiV1/market/assets';

  // Notifications
  static const String notifications    = '$apiV1/notifications';
  static const String unreadCount      = '$apiV1/notifications/unread-count';
  static const String markAllRead      = '$apiV1/notifications/read-all';
  static const String registerToken    = '$apiV1/notifications/register-token';
  static const String testNotification = '$apiV1/notifications/test';

  // Telegram
  static const String telegramLink   = '$apiV1/telegram/generate-link';
  static const String telegramUnlink = '$apiV1/telegram/unlink';

  // User
  static const String preferences    = '$apiV1/users/preferences';

  // Virtual Portfolio
  static const String virtualPerformance = '$apiV1/virtual/performance';
  static const String virtualTrades      = '$apiV1/virtual/trades';
  static const String virtualReset       = '$apiV1/virtual/reset';
  static const String virtualSetCapital  = '$apiV1/virtual/set-capital';

  // AI
  static const String aiStatus       = '$apiV1/ai/status';

  // WebSocket
  static const String wsUrl = String.fromEnvironment(
    'WS_URL',
    defaultValue: 'ws://10.0.2.2:5000/ws',
  );
}
