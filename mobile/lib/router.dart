import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/providers/auth_provider.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/shell/app_shell.dart';
import 'features/performance/virtual_performance_screen.dart';
import 'features/performance/virtual_trades_screen.dart';
import 'features/advisor/advisor_screen.dart';
import 'features/brain/brain_report_screen.dart';
import 'features/guide/guide_screen.dart';
import 'features/reno/reno_screen.dart';
import 'features/watchlist/watchlist_screen.dart';
import 'features/brain/ask_brain_screen.dart';
import 'features/scanner/market_scanner_screen.dart';
import 'features/trades/trade_history_screen.dart';
import 'features/backtest/backtest_screen.dart';
import 'features/dca/dca_screen.dart';
import 'features/signals/signal_detail_screen.dart';
import 'features/history/ai_decision_history_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final authed = authState.isAuthenticated;
      final onAuth = state.matchedLocation.startsWith('/login') ||
                     state.matchedLocation.startsWith('/register');
      if (!authed && !onAuth) return '/login';
      if (authed  && onAuth)  return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login',    builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),

      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(path: '/',              builder: (_, __) => const GuideScreen()),
          GoRoute(path: '/reno',          builder: (_, __) => const RenoScreen()),
          GoRoute(path: '/brain',         builder: (_, __) => const BrainReportScreen()),
          GoRoute(path: '/performance',   builder: (_, __) => const VirtualPerformanceScreen()),
          GoRoute(path: '/real-portfolio', builder: (_, __) => const VirtualTradesScreen()),
          GoRoute(path: '/advisor',       builder: (_, __) => const AdvisorScreen()),
          GoRoute(path: '/watchlist',     builder: (_, __) => const WatchlistScreen()),
          GoRoute(path: '/scanner',      builder: (_, __) => const MarketScannerScreen()),
          GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
          GoRoute(path: '/settings',      builder: (_, __) => const SettingsScreen()),
          GoRoute(path: '/ask-brain',    builder: (_, __) => const AskBrainScreen()),
          GoRoute(path: '/trades',       builder: (_, __) => const TradeHistoryScreen()),
          GoRoute(path: '/backtest',     builder: (_, __) => const BacktestScreen()),
          GoRoute(path: '/dca',          builder: (_, __) => const DCAScreen()),
          // Bug fix (2026-09-04, overnight continuous-improvement pass):
          // notifications_screen.dart has always pushed here on a tap of
          // any notification carrying a signalId (a real, backend-populated
          // field), but this route was removed at some point -- almost
          // certainly during the decision-#21 migration to a single Guide
          // main screen -- while the call site and signal_detail_screen.dart
          // itself were both left behind unregistered. Every such tap threw
          // a "no route found" error, so the always-reachable Alerts tab
          // silently dead-ended. Re-registering this as a normal secondary
          // detail route (reached only by navigating in, never part of the
          // main tab bar) doesn't reintroduce a second "main" screen and
          // isn't in tension with decision #21 -- it's the same category of
          // route as /trades, /dca, /backtest, etc. above.
          GoRoute(path: '/signals/:id', builder: (_, state) =>
              SignalDetailScreen(signalId: state.pathParameters['id']!)),
          GoRoute(path: '/ai-decisions', builder: (_, __) => const AIDecisionHistoryScreen()),
        ],
      ),
    ],
  );
});
