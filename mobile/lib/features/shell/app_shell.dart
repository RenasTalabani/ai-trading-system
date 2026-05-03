import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers/notifications_provider.dart';

class AppShell extends ConsumerWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  static const _tabs = [
    _TabItem(label: 'Home',      icon: Icons.home_outlined,          path: '/'),
    _TabItem(label: 'Advisor',   icon: Icons.psychology_outlined,    path: '/advisor'),
    _TabItem(label: 'Simulator', icon: Icons.science_outlined,       path: '/simulator'),
    _TabItem(label: 'Reports',   icon: Icons.article_outlined,       path: '/reports'),
    _TabItem(label: 'Portfolio', icon: Icons.bar_chart_outlined,     path: '/performance'),
    _TabItem(label: 'Alerts',    icon: Icons.notifications_none,     path: '/notifications'),
    _TabItem(label: 'Settings',  icon: Icons.settings_outlined,      path: '/settings'),
  ];

  int _indexFor(BuildContext context) {
    final loc = GoRouterState.of(context).matchedLocation;
    if (loc.startsWith('/advisor'))       return 1;
    if (loc.startsWith('/simulator'))     return 2;
    if (loc.startsWith('/reports'))       return 3;
    if (loc.startsWith('/performance'))   return 4;
    if (loc.startsWith('/notifications')) return 5;
    if (loc.startsWith('/settings'))      return 6;
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
        child: NavigationBar(
          selectedIndex: current,
          onDestinationSelected: (i) {
            if (i != current) context.go(_tabs[i].path);
          },
          backgroundColor: AppColors.card,
          indicatorColor: AppColors.primary.withValues(alpha: 0.15),
          labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
          destinations: _tabs.asMap().entries.map((e) {
            final i   = e.key;
            final tab = e.value;
            final showBadge = i == 5 && unread > 0;
            return NavigationDestination(
              icon: showBadge
                  ? Badge(label: Text('$unread'), child: Icon(tab.icon, color: AppColors.textMuted))
                  : Icon(tab.icon, color: AppColors.textMuted),
              selectedIcon: showBadge
                  ? Badge(label: Text('$unread'), child: Icon(tab.icon, color: AppColors.primary))
                  : Icon(tab.icon, color: AppColors.primary),
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
