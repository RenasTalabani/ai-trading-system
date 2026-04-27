import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers/notifications_provider.dart';

class AppShell extends ConsumerWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  static const _tabs = [
    _TabItem(label: 'Dashboard',   icon: Icons.dashboard_outlined,    path: '/'),
    _TabItem(label: 'Signals',     icon: Icons.signal_cellular_alt,   path: '/signals'),
    _TabItem(label: 'Strategy',    icon: Icons.auto_graph,            path: '/strategy'),
    _TabItem(label: 'Performance', icon: Icons.bar_chart_outlined,    path: '/performance'),
    _TabItem(label: 'Alerts',      icon: Icons.notifications_none,    path: '/notifications'),
    _TabItem(label: 'Settings',    icon: Icons.settings_outlined,     path: '/settings'),
  ];

  int _indexFor(BuildContext context) {
    final loc = GoRouterState.of(context).matchedLocation;
    if (loc.startsWith('/signals'))       return 1;
    if (loc.startsWith('/strategy'))      return 2;
    if (loc.startsWith('/performance'))   return 3;
    if (loc.startsWith('/notifications')) return 4;
    if (loc.startsWith('/settings'))      return 5;
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread  = ref.watch(notificationsProvider).unreadCount;
    final current = _indexFor(context);

    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: BottomNavigationBar(
          currentIndex: current,
          onTap: (i) {
            if (i != current) context.go(_tabs[i].path);
          },
          items: _tabs.asMap().entries.map((e) {
            final i    = e.key;
            final tab  = e.value;
            final badge = i == 4 && unread > 0;
            return BottomNavigationBarItem(
              icon: badge
                  ? Badge(label: Text('$unread'), child: Icon(tab.icon))
                  : Icon(tab.icon),
              label: tab.label,
            );
          }).toList(),
        ),
      ),
    );
  }
}

class _TabItem {
  final String label;
  final IconData icon;
  final String path;
  const _TabItem({required this.label, required this.icon, required this.path});
}
