import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'core/theme/app_theme.dart';
import 'core/services/websocket_service.dart';
import 'core/services/push_notification_service.dart';
import 'core/services/api_service.dart';
import 'core/providers/auth_provider.dart';
import 'core/providers/prices_provider.dart';
import 'router.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));

  // Firebase init (fails gracefully if google-services.json not configured)
  try {
    await Firebase.initializeApp();
    await PushNotificationService.init();
  } catch (_) {}

  // Connect WebSocket
  WebSocketService.instance.connect();

  runApp(const ProviderScope(child: TradingApp()));
}

// Bug fix (2026-09-01, reported from a real device: prices/positions going
// stuck after the app sits in the background). TradingApp used to be a
// stateless ConsumerWidget with no app-lifecycle awareness at all -- once
// the OS suspended the app, the WebSocket could die silently and nothing
// ever reconnected it or forced a fresh fetch when the user came back.
// Converting to ConsumerStatefulWidget + WidgetsBindingObserver lets us
// reconnect the socket and force an immediate price refresh the moment the
// app resumes, instead of waiting on prices_provider's 30s poll or a WS
// message that may never arrive. connect() is a safe no-op if already
// connected/connecting (see websocket_service.dart), so this never opens a
// duplicate socket.
class TradingApp extends ConsumerStatefulWidget {
  const TradingApp({super.key});

  @override
  ConsumerState<TradingApp> createState() => _TradingAppState();
}

class _TradingAppState extends ConsumerState<TradingApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      WebSocketService.instance.connect();
      ref.read(pricesProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);

    // Wire notification tap navigation to GoRouter
    PushNotificationService.onNavigate = (route) => router.go(route);

    // Wire 401 → auto-logout so stale tokens don't leave the app broken
    ApiService.onUnauthorized = () =>
        ref.read(authProvider.notifier).logout();

    return MaterialApp.router(
      title:        'AI Trader',
      debugShowCheckedModeBanner: false,
      theme:        AppTheme.dark,
      routerConfig: router,
    );
  }
}
