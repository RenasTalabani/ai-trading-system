class ApiConstants {
  // Override at build time:
  //   flutter build apk --release \
  //     --dart-define=API_BASE_URL=https://YOUR_BACKEND.railway.app \
  //     --dart-define=WS_URL=wss://YOUR_BACKEND.railway.app/ws
  //
  // Bug fix (2026-09-01): this default used to point at
  // distinguished-empathy-production-5d79.up.railway.app, which returns a
  // Railway "Application not found" 404 on every path (verified live) --
  // an old/decommissioned service URL, not the real backend. build-railway-apk.bat
  // already overrides this correctly via --dart-define, which is why the
  // shipped APK has been fine, but any `flutter run`/debug session started
  // without that script would silently talk to a dead backend with no
  // obvious error. Updated to the real, currently-live backend (verified
  // live just now: GET /api/v1/health -> 200, backend/database/aiService
  // all connected).
  static const String _base = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://backend-production-bd777.up.railway.app',
  );

  static const String baseUrl = _base;
  static const String apiV1   = '$_base/api/v1';

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
  static const String aiStatus = '$apiV1/ai/status';

  // Guide — "just tell me what to do"
  static const String guideSuggestion = '$apiV1/guide/suggestion';
  static const String guideApprove    = '$apiV1/guide/suggestion/approve';
  static const String guidePositions  = '$apiV1/guide/positions';

  // RENO conversation -- Phase 3 (2026-09-01)
  static const String conversationThread  = '$apiV1/conversation';
  static const String conversationMessage = '$apiV1/conversation/message';
  static const String conversationApprove = '$apiV1/conversation/approve';

  // WebSocket
  static const String wsUrl = String.fromEnvironment(
    'WS_URL',
    defaultValue: 'wss://backend-production-bd777.up.railway.app/ws',
  );
}
