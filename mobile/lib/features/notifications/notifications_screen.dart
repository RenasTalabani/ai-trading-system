import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import '../../core/providers/notifications_provider.dart';
import '../../core/models/notification_model.dart';
import '../../core/theme/app_theme.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          const Text('Notifications'),
          if (state.unreadCount > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('${state.unreadCount}',
                  style: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ]),
        actions: [
          if (state.unreadCount > 0)
            TextButton(
              onPressed: () => ref.read(notificationsProvider.notifier).markAllRead(),
              child: const Text('Mark all read', style: TextStyle(color: AppColors.primary, fontSize: 13)),
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(notificationsProvider.notifier).fetch(),
          ),
        ],
      ),
      body: state.loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : state.items.isEmpty
              ? _EmptyState()
              : RefreshIndicator(
                  onRefresh: () => ref.read(notificationsProvider.notifier).fetch(),
                  color: AppColors.primary,
                  backgroundColor: AppColors.card,
                  child: ListView.separated(
                    itemCount: state.items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
                    itemBuilder: (_, i) => _NotificationTile(
                      item: state.items[i],
                      onRead:   () => ref.read(notificationsProvider.notifier).markRead(state.items[i].id),
                      onDelete: () => ref.read(notificationsProvider.notifier).delete(state.items[i].id),
                    ),
                  ),
                ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final NotificationModel item;
  final VoidCallback onRead;
  final VoidCallback onDelete;

  const _NotificationTile({required this.item, required this.onRead, required this.onDelete});

  IconData get _icon {
    switch (item.data.action) {
      case 'BUY':  return Icons.trending_up;
      case 'SELL': return Icons.trending_down;
      default:     return Icons.notifications_outlined;
    }
  }

  Color get _iconColor {
    switch (item.data.action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final timeAgo = _formatRelative(item.createdAt);
    final unread  = !item.isRead;

    return Dismissible(
      key: Key(item.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: AppColors.error,
        child: const Icon(Icons.delete_outline, color: Colors.white),
      ),
      onDismissed: (_) => onDelete(),
      child: InkWell(
        onTap: () {
          if (unread) onRead();
          if (item.data.signalId != null) {
            context.push('/signals/${item.data.signalId}');
          }
        },
        child: Container(
          color: unread ? AppColors.primary.withValues(alpha: 0.04) : Colors.transparent,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: _iconColor.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(_icon, color: _iconColor, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(child: Text(item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: unread ? FontWeight.w600 : FontWeight.normal,
                        color: AppColors.textPrimary,
                      ))),
                  Text(timeAgo,
                      style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                ]),
                const SizedBox(height: 3),
                Text(item.body,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.4)),
                if (item.data.asset != null) ...[
                  const SizedBox(height: 6),
                  Row(children: [
                    _Chip(item.data.asset!),
                    if (item.data.confidence != null) ...[
                      const SizedBox(width: 6),
                      _Chip('${item.data.confidence!.toStringAsFixed(0)}%'),
                    ],
                  ]),
                ],
              ],
            )),
            if (unread)
              Container(
                width: 8, height: 8, margin: const EdgeInsets.only(left: 8, top: 4),
                decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
              ),
          ]),
        ),
      ),
    );
  }

  String _formatRelative(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1)  return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24) return '${diff.inHours}h ago';
    return DateFormat('MMM d').format(dt);
  }
}

class _Chip extends StatelessWidget {
  final String label;
  const _Chip(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
    );
  }
}

class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return const Center(child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.notifications_none, size: 56, color: AppColors.textMuted),
        SizedBox(height: 16),
        Text('No notifications yet', style: TextStyle(color: AppColors.textSecondary)),
        SizedBox(height: 4),
        Text('You\'ll be notified when new signals are generated.',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
      ],
    ));
  }
}
