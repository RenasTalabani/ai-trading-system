import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/auth_provider.dart';
import '../../core/providers/signals_provider.dart';
import '../../core/providers/prices_provider.dart';
import '../../core/services/websocket_service.dart';
import '../../core/theme/app_theme.dart';
import 'widgets/signal_card.dart';
import 'widgets/price_ticker.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  StreamSubscription? _wsSub;

  @override
  void initState() {
    super.initState();
    _wsSub = WebSocketService.instance.stream.listen((msg) {
      if (!mounted) return;
      if (msg.type == 'signal' || msg.type == 'new_signal') {
        ref.read(signalsProvider.notifier).fetch();
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user     = ref.watch(authProvider).user;
    final sigState = ref.watch(signalsProvider);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () => ref.read(signalsProvider.notifier).fetch(),
        color: AppColors.primary,
        backgroundColor: AppColors.card,
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              floating: true,
              snap:     true,
              title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Good ${_greeting()}, ${user?.name.split(' ').first ?? ''}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const Text('Live AI Trading Signals',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              ]),
              actions: [
                _WsStatusDot(),
                const SizedBox(width: 16),
              ],
              bottom: const PreferredSize(
                preferredSize: Size.fromHeight(44),
                child: PriceTickerBar(),
              ),
            ),

            // Summary row
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: _SummaryRow(signals: sigState.signals),
              ),
            ),

            // Signals header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Active Signals',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
                    if (sigState.signals.isNotEmpty)
                      Text('${sigState.signals.length} signals',
                          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  ],
                ),
              ),
            ),

            // Error banner (only when we already have data)
            if (sigState.error != null && sigState.signals.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.sell.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.sell.withValues(alpha: 0.3)),
                    ),
                    child: Row(children: [
                      const Icon(Icons.wifi_off, size: 14, color: AppColors.sell),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text('Showing cached data — server unreachable',
                            style: TextStyle(fontSize: 12, color: AppColors.sell)),
                      ),
                      GestureDetector(
                        onTap: () => ref.read(signalsProvider.notifier).fetch(),
                        child: const Icon(Icons.refresh, size: 14, color: AppColors.sell),
                      ),
                    ]),
                  ),
                ),
              ),

            // Signal list
            if (sigState.loading)
              const SliverFillRemaining(child: Center(child: CircularProgressIndicator(color: AppColors.primary)))
            else if (sigState.error != null && sigState.signals.isEmpty)
              SliverFillRemaining(child: _ErrorState(message: sigState.error!,
                  onRetry: () => ref.read(signalsProvider.notifier).fetch()))
            else if (sigState.signals.isEmpty)
              const SliverFillRemaining(child: _EmptyState())
            else
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (ctx, i) => SignalCard(signal: sigState.signals[i]),
                  childCount: sigState.signals.length,
                ),
              ),

            const SliverPadding(padding: EdgeInsets.only(bottom: 24)),
          ],
        ),
      ),
    );
  }

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }
}

class _SummaryRow extends StatelessWidget {
  final List signals;
  const _SummaryRow({required this.signals});

  @override
  Widget build(BuildContext context) {
    final buys  = signals.where((s) => s.direction == 'BUY').length;
    final sells = signals.where((s) => s.direction == 'SELL').length;
    final avgConf = signals.isEmpty ? 0.0
        : signals.map((s) => s.confidence as double).reduce((a, b) => a + b) / signals.length;

    return Row(children: [
      _StatTile(value: '$buys',              label: 'BUY',        color: AppColors.buy),
      const SizedBox(width: 8),
      _StatTile(value: '$sells',             label: 'SELL',       color: AppColors.sell),
      const SizedBox(width: 8),
      _StatTile(value: '${avgConf.toStringAsFixed(0)}%', label: 'Avg Conf', color: AppColors.primary),
    ]);
  }
}

class _StatTile extends StatelessWidget {
  final String value;
  final String label;
  final Color color;
  const _StatTile({required this.value, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Column(children: [
        Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
        const SizedBox(height: 2),
        Text(label,  style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
      ]),
    ));
  }
}

class _WsStatusDot extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final _ = ref.watch(pricesProvider); // rebuild when prices update = WS alive
    final status = WebSocketService.instance.status;
    final color = status == WsStatus.connected ? AppColors.buy : AppColors.sell;
    return Tooltip(
      message: status.name,
      child: Container(
        width: 8, height: 8,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return const Center(child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.signal_cellular_alt, size: 56, color: AppColors.textMuted),
        SizedBox(height: 16),
        Text('No active signals yet', style: TextStyle(color: AppColors.textSecondary)),
        SizedBox(height: 4),
        Text('The AI engine is scanning markets…',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
      ],
    ));
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.wifi_off, size: 48, color: AppColors.textMuted),
        const SizedBox(height: 12),
        Text(message, style: const TextStyle(color: AppColors.textSecondary)),
        const SizedBox(height: 16),
        TextButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh),
          label: const Text('Retry'),
        ),
      ],
    ));
  }
}
