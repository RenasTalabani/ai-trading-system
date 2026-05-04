import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'core/theme/app_theme.dart';
import 'core/services/websocket_service.dart';
import 'core/services/push_notification_service.dart';
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

class TradingApp extends ConsumerWidget {
  const TradingApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    // Wire notification tap navigation to GoRouter
    PushNotificationService.onNavigate = (route) => router.go(route);

    return MaterialApp.router(
      title:        'AI Trader',
      debugShowCheckedModeBanner: false,
      theme:        AppTheme.dark,
      routerConfig: router,
    );
  }
}
