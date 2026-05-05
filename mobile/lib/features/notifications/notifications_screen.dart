import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/providers/notifications_provider.dart';
import '../../core/providers/price_alerts_provider.dart';
import '../../core/providers/prices_provider.dart';
import '../../core/providers/brain_provider.dart' show highImpactNewsProvider, NewsItem;
import '../../core/models/notification_model.dart';
import '../../core/theme/app_theme.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final notifState = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          const Text('Alerts'),
          if (notifState.unreadCount > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('${notifState.unreadCount}',
                  style: const TextStyle(fontSize: 11, color: Colors.white,
                      fontWeight: FontWeight.bold)),
            ),
          ],
        ]),
        actions: [
          if (notifState.unreadCount > 0 && _tabs.index == 0)
            TextButton(
              onPressed: () =>
                  ref.read(notificationsProvider.notifier).markAllRead(),
              child: const Text('Mark all read',
                  style: TextStyle(color: AppColors.primary, fontSize: 13)),
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              if (_tabs.index == 0) {
                ref.read(notificationsProvider.notifier).fetch();
              } else {
                ref.read(priceAlertsProvider.notifier).fetch();
              }
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.primary,
          labelColor: AppColors.primary,
          unselectedLabelColor: AppColors.textSecondary,
          tabs: const [
            Tab(text: 'Notifications'),
            Tab(text: 'Price Alerts'),
            Tab(text: 'News'),
          ],
          onTap: (_) => setState(() {}),
        ),
      ),
      floatingActionButton: AnimatedBuilder(
        animation: _tabs,
        builder: (_, __) => _tabs.index == 1
            ? FloatingActionButton(
                backgroundColor: AppColors.primary,
                onPressed: () => _showCreateAlert(context),
                child: const Icon(Icons.add, color: Colors.white),
              )
            : const SizedBox.shrink(),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _NotificationsTab(state: notifState),
          const _PriceAlertsTab(),
          const _NewsTab(),
        ],
      ),
    );
  }

  void _showCreateAlert(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _CreateAlertSheet(),
    );
  }
}

// ── Notifications tab ─────────────────────────────────────────────────────────

class _NotificationsTab extends ConsumerWidget {
  final NotificationsState state;
  const _NotificationsTab({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.loading) {
      return const Center(child: CircularProgressIndicator(color: AppColors.primary));
    }
    if (state.items.isEmpty) {
      return const _EmptyHint(
        icon: Icons.notifications_none,
        title: 'No notifications yet',
        subtitle: 'You\'ll be notified when new signals are generated.',
      );
    }
    return RefreshIndicator(
      onRefresh: () => ref.read(notificationsProvider.notifier).fetch(),
      color: AppColors.primary,
      backgroundColor: AppColors.card,
      child: ListView.separated(
        itemCount: state.items.length,
        separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
        itemBuilder: (_, i) => _NotificationTile(
          item: state.items[i],
          onRead: () =>
              ref.read(notificationsProvider.notifier).markRead(state.items[i].id),
          onDelete: () =>
              ref.read(notificationsProvider.notifier).delete(state.items[i].id),
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final NotificationModel item;
  final VoidCallback onRead;
  final VoidCallback onDelete;
  const _NotificationTile(
      {required this.item, required this.onRead, required this.onDelete});

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
    final unread = !item.isRead;
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
          color: unread
              ? AppColors.primary.withValues(alpha: 0.04)
              : Colors.transparent,
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
                  Text(_formatRelative(item.createdAt),
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.textMuted)),
                ]),
                const SizedBox(height: 3),
                Text(item.body,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                        height: 1.4)),
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
                width: 8, height: 8,
                margin: const EdgeInsets.only(left: 8, top: 4),
                decoration: const BoxDecoration(
                    color: AppColors.primary, shape: BoxShape.circle),
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

// ── Price Alerts tab ──────────────────────────────────────────────────────────

class _PriceAlertsTab extends ConsumerWidget {
  const _PriceAlertsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state  = ref.watch(priceAlertsProvider);
    final prices = ref.watch(pricesProvider);

    if (state.loading && state.alerts.isEmpty) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.primary));
    }

    if (state.alerts.isEmpty) {
      return const _EmptyHint(
        icon: Icons.notifications_active_outlined,
        title: 'No price alerts',
        subtitle: 'Tap + to set an alert for when any asset hits your target price.',
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(priceAlertsProvider.notifier).fetch(),
      color: AppColors.primary,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: state.alerts.length,
        separatorBuilder: (_, __) => const Divider(height: 1, indent: 16),
        itemBuilder: (_, i) {
          final alert = state.alerts[i];
          final currentPrice = prices[alert.asset];
          return _AlertTile(
            alert: alert,
            currentPrice: currentPrice,
            onDelete: () =>
                ref.read(priceAlertsProvider.notifier).delete(alert.id),
            onToggle: () =>
                ref.read(priceAlertsProvider.notifier).toggle(alert.id),
          );
        },
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  final PriceAlertModel alert;
  final double?         currentPrice;
  final VoidCallback    onDelete;
  final VoidCallback    onToggle;
  const _AlertTile({
    required this.alert,
    required this.onDelete,
    required this.onToggle,
    this.currentPrice,
  });

  @override
  Widget build(BuildContext context) {
    final isAbove    = alert.direction == 'above';
    final triggered  = alert.triggeredAt != null;
    final accentColor = triggered
        ? AppColors.textMuted
        : isAbove
            ? AppColors.buy
            : AppColors.sell;

    double? progress;
    if (currentPrice != null && currentPrice! > 0) {
      if (isAbove) {
        progress = (currentPrice! / alert.targetPrice).clamp(0.0, 1.0);
      } else {
        progress = (alert.targetPrice / currentPrice!).clamp(0.0, 1.0);
      }
    }

    return Dismissible(
      key: Key(alert.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: AppColors.error,
        child: const Icon(Icons.delete_outline, color: Colors.white),
      ),
      onDismissed: (_) => onDelete(),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        color: triggered
            ? AppColors.textMuted.withValues(alpha: 0.04)
            : alert.active
                ? Colors.transparent
                : AppColors.surface,
        child: Row(children: [
          // Direction icon
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              color: accentColor.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(
              triggered
                  ? Icons.check_circle_outline
                  : isAbove
                      ? Icons.arrow_upward
                      : Icons.arrow_downward,
              color: accentColor, size: 20,
            ),
          ),

          const SizedBox(width: 12),

          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Text(alert.displayName,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: triggered
                          ? AppColors.textMuted
                          : AppColors.textPrimary,
                    )),
                const SizedBox(width: 6),
                _DirectionBadge(
                    direction: alert.direction, color: accentColor),
                const Spacer(),
                Text('\$${_fmt(alert.targetPrice)}',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: accentColor,
                    )),
              ]),
              const SizedBox(height: 4),
              if (currentPrice != null && !triggered)
                Row(children: [
                  Text('Now: \$${_fmt(currentPrice!)}',
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.textMuted)),
                  if (progress != null) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(
                          value: progress,
                          minHeight: 3,
                          backgroundColor: AppColors.border,
                          valueColor:
                              AlwaysStoppedAnimation(accentColor),
                        ),
                      ),
                    ),
                  ],
                ])
              else if (triggered && alert.triggeredAt != null)
                Text('Triggered ${_formatRelative(alert.triggeredAt!)}',
                    style: const TextStyle(
                        fontSize: 11, color: AppColors.textMuted)),
              if (alert.note.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(alert.note,
                    style: const TextStyle(
                        fontSize: 11, color: AppColors.textSecondary)),
              ],
            ],
          )),

          const SizedBox(width: 8),

          // Toggle switch (only for non-triggered)
          if (!triggered)
            Switch(
              value: alert.active,
              onChanged: (_) => onToggle(),
              activeThumbColor: AppColors.primary,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
        ]),
      ),
    );
  }

  String _fmt(double v) {
    if (v >= 10000) return v.toStringAsFixed(0);
    if (v >= 100)   return v.toStringAsFixed(1);
    if (v >= 1)     return v.toStringAsFixed(2);
    return v.toStringAsFixed(4);
  }

  String _formatRelative(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1)  return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours   < 24) return '${diff.inHours}h ago';
    return DateFormat('MMM d').format(dt);
  }
}

class _DirectionBadge extends StatelessWidget {
  final String direction;
  final Color  color;
  const _DirectionBadge({required this.direction, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(direction.toUpperCase(),
          style: TextStyle(
              fontSize: 9, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

// ── Create Alert bottom sheet ─────────────────────────────────────────────────

const _kAlertAssets = [
  ('BTC', 'BTCUSDT'),  ('ETH', 'ETHUSDT'),  ('BNB', 'BNBUSDT'),
  ('SOL', 'SOLUSDT'),  ('XRP', 'XRPUSDT'),  ('ADA', 'ADAUSDT'),
  ('DOGE', 'DOGEUSDT'),('AVAX', 'AVAXUSDT'), ('LINK', 'LINKUSDT'),
];

class _CreateAlertSheet extends ConsumerStatefulWidget {
  const _CreateAlertSheet();

  @override
  ConsumerState<_CreateAlertSheet> createState() => _CreateAlertSheetState();
}

class _CreateAlertSheetState extends ConsumerState<_CreateAlertSheet> {
  String _selectedAsset     = 'BTCUSDT';
  String _selectedDisplay   = 'BTC';
  String _direction         = 'above';
  final _priceCtrl          = TextEditingController();
  final _noteCtrl           = TextEditingController();
  bool   _saving            = false;

  @override
  void dispose() {
    _priceCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final price = double.tryParse(_priceCtrl.text);
    if (price == null || price <= 0) return;

    setState(() => _saving = true);
    final ok = await ref.read(priceAlertsProvider.notifier).create(
      asset:        _selectedAsset,
      displayName:  _selectedDisplay,
      targetPrice:  price,
      direction:    _direction,
      note:         _noteCtrl.text.trim(),
    );
    if (mounted) {
      Navigator.pop(context);
      if (ok) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Alert set for $_selectedDisplay at \$$price'),
            backgroundColor: AppColors.buy,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final prices = ref.watch(pricesProvider);
    final current = prices[_selectedAsset];

    return Padding(
      padding: EdgeInsets.only(
        left: 20, right: 20, top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        // Handle
        Container(
          width: 40, height: 4,
          margin: const EdgeInsets.only(bottom: 20),
          decoration: BoxDecoration(
            color: AppColors.border,
            borderRadius: BorderRadius.circular(2),
          ),
        ),

        const Text('New Price Alert',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
        const SizedBox(height: 20),

        // Asset picker
        SizedBox(
          height: 44,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: _kAlertAssets.map((pair) {
              final selected = _selectedAsset == pair.$2;
              return GestureDetector(
                onTap: () => setState(() {
                  _selectedAsset   = pair.$2;
                  _selectedDisplay = pair.$1;
                  if (prices[pair.$2] != null) {
                    _priceCtrl.text = prices[pair.$2]!.toStringAsFixed(2);
                  }
                }),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  margin: const EdgeInsets.only(right: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.primary.withValues(alpha: 0.2)
                        : AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: selected ? AppColors.primary : AppColors.border),
                  ),
                  child: Text(pair.$1,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
                        color: selected ? AppColors.primary : AppColors.textSecondary,
                      )),
                ),
              );
            }).toList(),
          ),
        ),

        if (current != null) ...[
          const SizedBox(height: 8),
          Text('Current price: \$${current.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ],

        const SizedBox(height: 16),

        // Direction toggle
        Row(children: [
          const Text('Alert when price is',
              style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(width: 12),
          _DirChip(
            label: 'Above',
            selected: _direction == 'above',
            color: AppColors.buy,
            onTap: () => setState(() => _direction = 'above'),
          ),
          const SizedBox(width: 8),
          _DirChip(
            label: 'Below',
            selected: _direction == 'below',
            color: AppColors.sell,
            onTap: () => setState(() => _direction = 'below'),
          ),
        ]),

        const SizedBox(height: 16),

        // Price field
        TextField(
          controller: _priceCtrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontSize: 16, color: AppColors.textPrimary),
          decoration: const InputDecoration(
            labelText: 'Target Price (USD)',
            prefixText: '\$ ',
            prefixStyle: TextStyle(color: AppColors.textSecondary),
            contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          ),
        ),

        const SizedBox(height: 12),

        // Note field
        TextField(
          controller: _noteCtrl,
          style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
          decoration: const InputDecoration(
            labelText: 'Note (optional)',
            contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
        ),

        const SizedBox(height: 20),

        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _saving ? null : _save,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
            child: _saving
                ? const SizedBox(width: 20, height: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : const Text('Set Alert',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          ),
        ),
      ]),
    );
  }
}

class _DirChip extends StatelessWidget {
  final String   label;
  final bool     selected;
  final Color    color;
  final VoidCallback onTap;
  const _DirChip({
    required this.label, required this.selected,
    required this.color, required this.onTap,
  });

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: selected ? color.withValues(alpha: 0.2) : AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: selected ? color : AppColors.border),
      ),
      child: Text(label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
            color: selected ? color : AppColors.textSecondary,
          )),
    ),
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

class _EmptyHint extends StatelessWidget {
  final IconData icon;
  final String   title;
  final String   subtitle;
  const _EmptyHint(
      {required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 56, color: AppColors.textMuted),
        const SizedBox(height: 16),
        Text(title,
            style: const TextStyle(color: AppColors.textSecondary,
                fontSize: 15, fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
      ]),
    ),
  );
}

class _Chip extends StatelessWidget {
  final String label;
  const _Chip(this.label);

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(4),
      border: Border.all(color: AppColors.border),
    ),
    child: Text(label,
        style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
  );
}

// ── News tab ──────────────────────────────────────────────────────────────────

class _NewsTab extends ConsumerWidget {
  const _NewsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final newsAsync = ref.watch(highImpactNewsProvider(20));
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async => ref.invalidate(highImpactNewsProvider(20)),
      child: newsAsync.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: AppColors.primary,
                strokeWidth: 2)),
        error: (_, __) => const _EmptyHint(
          icon: Icons.newspaper_outlined,
          title: 'News unavailable',
          subtitle: 'Pull to retry',
        ),
        data: (items) => items.isEmpty
            ? const _EmptyHint(
                icon: Icons.newspaper_outlined,
                title: 'No high-impact news',
                subtitle: 'Nothing significant in the last 12 hours',
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                separatorBuilder: (_, __) =>
                    const Divider(color: AppColors.border, height: 1),
                itemBuilder: (_, i) => _NewsCard(item: items[i]),
              ),
      ),
    );
  }
}

class _NewsCard extends StatelessWidget {
  final NewsItem item;
  const _NewsCard({required this.item});

  Color get _sentimentColor {
    switch (item.sentiment.toLowerCase()) {
      case 'bullish': return AppColors.buy;
      case 'bearish': return AppColors.sell;
      default:        return AppColors.hold;
    }
  }

  String _timeAgo(DateTime dt) {
    final d = DateTime.now().difference(dt);
    if (d.inMinutes < 60) return '${d.inMinutes}m ago';
    if (d.inHours < 24)   return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: item.url != null
        ? () => launchUrl(Uri.parse(item.url!),
              mode: LaunchMode.externalApplication)
        : null,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 4, height: 56,
          decoration: BoxDecoration(
            color: _sentimentColor,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
            children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: _sentimentColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(item.sentiment.toUpperCase(),
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                      color: _sentimentColor)),
            ),
            const SizedBox(width: 8),
            Text(item.source,
                style: const TextStyle(fontSize: 10,
                    color: AppColors.textMuted)),
            const Spacer(),
            Text(_timeAgo(item.publishedAt),
                style: const TextStyle(fontSize: 10,
                    color: AppColors.textMuted)),
            if (item.url != null) ...[
              const SizedBox(width: 4),
              const Icon(Icons.open_in_new, size: 11,
                  color: AppColors.textMuted),
            ],
          ]),
          const SizedBox(height: 6),
          Text(item.title,
              style: const TextStyle(fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textPrimary, height: 1.4)),
          if (item.impactScore > 0) ...[
            const SizedBox(height: 6),
            Row(children: [
              const Text('Impact: ',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
              SizedBox(
                width: 60, height: 4,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: LinearProgressIndicator(
                    value: (item.impactScore / 10).clamp(0.0, 1.0),
                    backgroundColor: AppColors.border,
                    valueColor: AlwaysStoppedAnimation(_sentimentColor),
                  ),
                ),
              ),
            ]),
          ],
        ])),
      ]),
    ),
  );
}
