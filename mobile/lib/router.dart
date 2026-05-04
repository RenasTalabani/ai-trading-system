import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/providers/auth_provider.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/shell/app_shell.dart';
import 'features/performance/virtual_performance_screen.dart';
import 'features/advisor/advisor_screen.dart';
import 'features/brain/brain_report_screen.dart';

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
          GoRoute(path: '/',              builder: (_, __) => const BrainReportScreen()),
          GoRoute(path: '/performance',   builder: (_, __) => const VirtualPerformanceScreen()),
          GoRoute(path: '/advisor',       builder: (_, __) => const AdvisorScreen()),
          GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
          GoRoute(path: '/settings',      builder: (_, __) => const SettingsScreen()),
        ],
      ),
    ],
  );
});
