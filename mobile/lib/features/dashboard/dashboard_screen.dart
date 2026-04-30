import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/auth_provider.dart';
import '../../core/providers/signals_provider.dart';
import '../../core/providers/prices_provider.dart';
import '../../core/providers/pnl_provider.dart';
import '../../core/providers/unified_provider.dart';
import '../../core/providers/global_provider.dart';
import '../../core/providers/budget_provider.dart';
import '../../core/providers/ai_brain_live_provider.dart';
import '../../core/models/pnl_model.dart';
import '../../core/services/storage_service.dart';
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
                const Text('AI Budget Manager — 24/7',
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

            // Global best opportunity card
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: _GlobalBestCard(),
              ),
            ),

            // Daily PnL card
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: _DailyPnLCard(),
              ),
            ),

            // Budget Manager control card
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: _BudgetControlCard(),
              ),
            ),

            // AI Brain live decisions
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: _AIBrainLiveCard(),
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
              const SliverFillRemaining(hasScrollBody: false, child: _EmptyState())
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

class _DailyPnLCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pnlAsync = ref.watch(pnlProvider);

    return pnlAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (PnLModel p) {
        if (p.trades == 0) return const SizedBox.shrink();
        final netPositive = p.net >= 0;
        final netColor = netPositive ? AppColors.buy : AppColors.sell;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: netColor.withValues(alpha: 0.25)),
          ),
          child: Row(
            children: [
              Icon(netPositive ? Icons.trending_up : Icons.trending_down,
                  color: netColor, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  "Today's PnL  ${netPositive ? '+' : ''}\$${p.net.toStringAsFixed(2)}",
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: netColor),
                ),
              ),
              _PnLChip('\$${p.profit.toStringAsFixed(2)}', AppColors.buy),
              const SizedBox(width: 6),
              _PnLChip('-\$${p.loss.toStringAsFixed(2)}', AppColors.sell),
              const SizedBox(width: 6),
              _PnLChip('${(p.winRate * 100).toStringAsFixed(0)}% WR',
                  AppColors.primary),
            ],
          ),
        );
      },
    );
  }
}

class _PnLChip extends StatelessWidget {
  final String label;
  final Color color;
  const _PnLChip(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10, fontWeight: FontWeight.w600, color: color)),
    );
  }
}

// ── Global Best Opportunity card ──────────────────────────────────────────────

class _GlobalBestCard extends ConsumerWidget {
  const _GlobalBestCard();

  Color _classColor(String assetClass) {
    switch (assetClass) {
      case 'commodity': return const Color(0xFFF59E0B);
      case 'forex':     return const Color(0xFF6366F1);
      default:          return AppColors.primary;
    }
  }

  IconData _classIcon(String assetClass) {
    switch (assetClass) {
      case 'commodity': return Icons.bar_chart;
      case 'forex':     return Icons.currency_exchange;
      default:          return Icons.currency_bitcoin;
    }
  }

  Color _actionColor(String action) {
    switch (action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scanAsync = ref.watch(globalScanProvider);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.primary.withValues(alpha: 0.06),
            AppColors.card,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Icon(Icons.travel_explore, color: AppColors.primary, size: 18),
            ),
            const SizedBox(width: 10),
            const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Best Opportunity Right Now',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
              Text('AI scanning all markets 24/7',
                  style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
            ])),
            GestureDetector(
              onTap: () => ref.read(globalScanProvider.notifier).loadLatest(),
              onLongPress: () => ref.read(globalScanProvider.notifier).scan(),
              child: const Icon(Icons.refresh, size: 16, color: AppColors.textSecondary),
            ),
          ]),

          const SizedBox(height: 14),

          scanAsync.when(
            loading: () => const SizedBox(
              height: 56,
              child: Center(child: CircularProgressIndicator(
                  color: AppColors.primary, strokeWidth: 2)),
            ),
            error: (e, _) => _GlobalScanError(
              message: e.toString(),
              onRetry: () => ref.read(globalScanProvider.notifier).loadLatest(),
            ),
            data: (result) {
              if (result == null || result.best == null) {
                return const SizedBox(
                  height: 40,
                  child: Center(
                    child: Text('No data yet — tap refresh',
                        style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
                  ),
                );
              }
              final best      = result.best!;
              final actColor  = _actionColor(best.action);
              final classColor = _classColor(best.assetClass);

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Best asset row
                  Row(children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: classColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(_classIcon(best.assetClass),
                          color: classColor, size: 16),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(best.displayName,
                            style: const TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w800,
                                color: AppColors.textPrimary)),
                        Row(children: [
                          _ClassBadge(label: best.assetClass.toUpperCase(),
                              color: classColor),
                          const SizedBox(width: 6),
                          if (best.trend != null)
                            Text(best.trend!,
                                style: const TextStyle(
                                    fontSize: 10, color: AppColors.textMuted)),
                        ]),
                      ],
                    )),
                    // Action badge
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: actColor,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(best.action,
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w900,
                              color: Colors.white)),
                    ),
                  ]),

                  const SizedBox(height: 12),

                  // Confidence bar
                  Row(children: [
                    Text('${best.confidence}% confidence',
                        style: TextStyle(
                            fontSize: 12, fontWeight: FontWeight.w600,
                            color: actColor)),
                    const Spacer(),
                    if (best.currentPrice != null)
                      Text('\$${_formatPrice(best.currentPrice!)}',
                          style: const TextStyle(
                              fontSize: 12, color: AppColors.textSecondary)),
                  ]),
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: best.confidence / 100,
                      minHeight: 6,
                      backgroundColor: AppColors.border,
                      valueColor: AlwaysStoppedAnimation(actColor),
                    ),
                  ),

                  // Reason
                  if (best.reason?.isNotEmpty == true) ...[
                    const SizedBox(height: 10),
                    Text(best.reason!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.textSecondary,
                            height: 1.4)),
                  ],

                  // Trade levels
                  if (best.stopLoss != null || best.takeProfit != null) ...[
                    const SizedBox(height: 10),
                    Row(children: [
                      if (best.stopLoss != null)
                        _MiniStat(label: 'SL',
                            value: '\$${_formatPrice(best.stopLoss!)}',
                            color: AppColors.sell),
                      if (best.takeProfit != null)
                        _MiniStat(label: 'TP',
                            value: '\$${_formatPrice(best.takeProfit!)}',
                            color: AppColors.buy),
                      if (best.riskReward != null)
                        _MiniStat(label: 'RR', value: best.riskReward!,
                            color: AppColors.primary),
                    ]),
                  ],

                  // Top-N chips
                  if (result.topOpportunities.length > 1) ...[
                    const SizedBox(height: 12),
                    const Text('Other top picks',
                        style: TextStyle(
                            fontSize: 10, color: AppColors.textMuted)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6, runSpacing: 6,
                      children: result.topOpportunities
                          .skip(1)
                          .take(4)
                          .map((o) => _OpportunityChip(opp: o))
                          .toList(),
                    ),
                  ],

                  // Scanned count
                  const SizedBox(height: 8),
                  Text('Scanned ${result.scanned} assets across all markets',
                      style: const TextStyle(
                          fontSize: 10, color: AppColors.textMuted)),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  String _formatPrice(double p) {
    if (p >= 1000) return p.toStringAsFixed(0);
    if (p >= 1)    return p.toStringAsFixed(2);
    return p.toStringAsFixed(4);
  }
}

class _GlobalScanError extends StatelessWidget {
  final String       message;
  final VoidCallback onRetry;
  const _GlobalScanError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      const Icon(Icons.error_outline, size: 14, color: AppColors.sell),
      const SizedBox(width: 8),
      Expanded(child: Text(message,
          style: const TextStyle(fontSize: 11, color: AppColors.sell))),
      TextButton(onPressed: onRetry, child: const Text('Retry',
          style: TextStyle(fontSize: 11))),
    ]);
  }
}

class _ClassBadge extends StatelessWidget {
  final String label;
  final Color  color;
  const _ClassBadge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label,
          style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700,
              color: color)),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _MiniStat({required this.label, required this.value,
      required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(fontSize: 9, color: AppColors.textMuted)),
        Text(value,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
                color: color)),
      ],
    ));
  }
}

class _OpportunityChip extends StatelessWidget {
  final GlobalOpportunity opp;
  const _OpportunityChip({required this.opp});

  @override
  Widget build(BuildContext context) {
    final color = opp.action == 'BUY'  ? AppColors.buy
                : opp.action == 'SELL' ? AppColors.sell
                : AppColors.hold;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(opp.displayName,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600,
                color: AppColors.textPrimary)),
        const SizedBox(width: 4),
        Text(opp.action,
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700,
                color: color)),
      ]),
    );
  }
}

// ── Phase 1: AI Brain control card ────────────────────────────────────────────

class _AIBrainControlCard extends ConsumerStatefulWidget {
  const _AIBrainControlCard();

  @override
  ConsumerState<_AIBrainControlCard> createState() => _AIBrainControlCardState();
}

class _AIBrainControlCardState extends ConsumerState<_AIBrainControlCard> {
  final _budgetCtrl = TextEditingController(text: '500');

  @override
  void initState() {
    super.initState();
    StorageService.getBudget().then((v) {
      if (!mounted) return;
      _budgetCtrl.text = v.toStringAsFixed(0);
      ref.read(aiBrainFormProvider.notifier).update((s) => s.copyWith(budget: v));
    });
  }

  @override
  void dispose() {
    _budgetCtrl.dispose();
    super.dispose();
  }

  void _onBudgetChanged(String raw) {
    final v = double.tryParse(raw);
    if (v == null || v <= 0) return;
    StorageService.saveBudget(v);
    ref.read(aiBrainFormProvider.notifier).update((s) => s.copyWith(budget: v));
  }

  @override
  Widget build(BuildContext context) {
    final form = ref.watch(aiBrainFormProvider);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.psychology, color: AppColors.primary, size: 18),
            ),
            const SizedBox(width: 10),
            const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('AI Investment Advisor',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
              Text('Full analysis — one tap',
                  style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
            ]),
          ]),

          const SizedBox(height: 14),

          // Budget + Asset row
          Row(children: [
            // Budget field
            Expanded(
              flex: 2,
              child: TextField(
                controller: _budgetCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: _onBudgetChanged,
                style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'Budget (\$)',
                  prefixText: '\$ ',
                  prefixStyle: TextStyle(color: AppColors.textSecondary),
                  contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
            ),
            const SizedBox(width: 10),
            // Asset dropdown
            Expanded(
              flex: 3,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: DropdownButton<String>(
                  value: form.asset,
                  isExpanded: true,
                  dropdownColor: AppColors.surface,
                  underline: const SizedBox.shrink(),
                  style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
                  items: kAIAssets.map((a) => DropdownMenuItem(
                    value: a,
                    child: Text(a, style: const TextStyle(fontSize: 13)),
                  )).toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    ref.read(aiBrainFormProvider.notifier).update((s) => s.copyWith(asset: v));
                  },
                ),
              ),
            ),
          ]),

          const SizedBox(height: 12),

          // Timeframe chips
          Row(children: kAITimeframes.map((tf) {
            final selected = form.timeframe == tf;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: GestureDetector(
                onTap: () => ref.read(aiBrainFormProvider.notifier)
                    .update((s) => s.copyWith(timeframe: tf)),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.primary.withValues(alpha: 0.2)
                        : AppColors.surface,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: selected ? AppColors.primary : AppColors.border,
                    ),
                  ),
                  child: Text(tf,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
                        color: selected ? AppColors.primary : AppColors.textSecondary,
                      )),
                ),
              ),
            );
          }).toList()),

          const SizedBox(height: 14),

          // Analyze button
          SizedBox(
            width: double.infinity,
            child: Consumer(builder: (context, r, _) {
              final loading = r.watch(aiBrainProvider).isLoading;
              return ElevatedButton.icon(
                onPressed: loading ? null : () => r.read(aiBrainProvider.notifier).analyze(),
                icon: loading
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.bolt, size: 18),
                label: Text(loading ? 'Analyzing…' : 'Analyze Now'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              );
            }),
          ),

          // Result card
          Consumer(builder: (context, r, _) {
            final state = r.watch(aiBrainProvider);
            return state.when(
              loading: () => const SizedBox.shrink(),
              error: (e, _) => Padding(
                padding: const EdgeInsets.only(top: 12),
                child: _AIBrainError(message: e.toString()),
              ),
              data: (result) => result == null
                  ? const SizedBox.shrink()
                  : Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: _AIBrainResultCard(result: result),
                    ),
            );
          }),
        ],
      ),
    );
  }
}

// ── Phase 2: Result widgets ────────────────────────────────────────────────────

class _AIBrainError extends StatelessWidget {
  final String message;
  const _AIBrainError({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.sell.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.sell.withValues(alpha: 0.3)),
      ),
      child: Row(children: [
        const Icon(Icons.error_outline, size: 16, color: AppColors.sell),
        const SizedBox(width: 8),
        Expanded(child: Text(message,
            style: const TextStyle(fontSize: 12, color: AppColors.sell))),
      ]),
    );
  }
}

class _AIBrainResultCard extends StatelessWidget {
  final AIBrainResult result;
  const _AIBrainResultCard({required this.result});

  Color _actionColor(String action) {
    switch (action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) {
    final sig   = result.signal;
    final tech  = result.technical;
    final sent  = result.sentiment;
    final alloc = result.allocation;
    final color = _actionColor(sig.action);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [

        // ── Header: action + confidence ──────────────────────────────────────
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
            child: Text(sig.action,
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white)),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${sig.confidence}% confidence',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color)),
            const SizedBox(height: 5),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: sig.confidence / 100,
                minHeight: 6,
                backgroundColor: AppColors.border,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
          ])),
          const SizedBox(width: 8),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(result.asset,
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            Text(result.timeframe,
                style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
          ]),
        ]),

        // ── WHY: AI Reasoning shown immediately after signal ────────────────
        if (sig.reason?.isNotEmpty == true) ...[
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Row(children: [
                Icon(Icons.lightbulb_outline, size: 12, color: AppColors.warning),
                SizedBox(width: 4),
                Text('WHY',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800,
                        color: AppColors.warning, letterSpacing: 0.8)),
              ]),
              const SizedBox(height: 6),
              ...sig.reason!.split(' | ').map((part) => Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('› ', style: TextStyle(fontSize: 12, color: AppColors.primary)),
                  Expanded(child: Text(part,
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary,
                          height: 1.4))),
                ]),
              )),
            ]),
          ),
        ],

        const SizedBox(height: 14),
        const Divider(color: AppColors.border, height: 1),
        const SizedBox(height: 12),

        // ── Allocation row ───────────────────────────────────────────────────
        Row(children: [
          _ResultStat(
            label: 'Allocate',
            value: '\$${alloc.recommended.toStringAsFixed(0)}',
            color: AppColors.primary,
          ),
          _ResultStat(
            label: 'Risk \$',
            value: '\$${alloc.riskAmount.toStringAsFixed(2)}',
            color: AppColors.sell,
          ),
          _ResultStat(
            label: 'Est. Profit',
            value: '\$${alloc.expectedProfit.toStringAsFixed(2)}',
            color: AppColors.buy,
          ),
          _ResultStat(
            label: 'Win Rate',
            value: '${alloc.winRate.toStringAsFixed(0)}%',
            color: AppColors.textPrimary,
          ),
        ]),

        // ── Trade levels ─────────────────────────────────────────────────────
        if (sig.entryZone != null || sig.stopLoss != null) ...[
          const SizedBox(height: 12),
          const Divider(color: AppColors.border, height: 1),
          const SizedBox(height: 10),
          Row(children: [
            const Icon(Icons.candlestick_chart, size: 13, color: AppColors.primary),
            const SizedBox(width: 6),
            const Text('Trade Levels',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            if (sig.riskReward != null)
              Row(children: [
                const Icon(Icons.balance, size: 11, color: AppColors.textMuted),
                const SizedBox(width: 3),
                Text('RR ${sig.riskReward}',
                    style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
              ]),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            if (sig.entryZone != null)
              _TradeStat(label: 'Entry', value: sig.entryZone!),
            if (sig.stopLoss != null)
              _TradeStat(label: 'Stop Loss',
                  value: '\$${sig.stopLoss!.toStringAsFixed(2)}',
                  color: AppColors.sell),
            if (sig.takeProfit != null)
              _TradeStat(label: 'Take Profit',
                  value: '\$${sig.takeProfit!.toStringAsFixed(2)}',
                  color: AppColors.buy),
          ]),
        ],

        // ── Market context ───────────────────────────────────────────────────
        if (tech.currentPrice != null) ...[
          const SizedBox(height: 12),
          const Divider(color: AppColors.border, height: 1),
          const SizedBox(height: 10),
          Row(children: [
            const Icon(Icons.show_chart, size: 13, color: AppColors.primary),
            const SizedBox(width: 6),
            const Text('Market Context',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            if (tech.trend != null)
              _SentimentBadge(sentiment: tech.trend!),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            _TradeStat(label: 'Price',
                value: '\$${tech.currentPrice!.toStringAsFixed(2)}'),
            if (tech.rsi != null)
              _TradeStat(label: 'RSI',
                  value: tech.rsi!.toStringAsFixed(1),
                  color: tech.rsi! > 70
                      ? AppColors.sell
                      : tech.rsi! < 30
                          ? AppColors.buy
                          : AppColors.textPrimary),
            if (tech.ema50 != null)
              _TradeStat(label: 'EMA 50',
                  value: '\$${tech.ema50!.toStringAsFixed(0)}'),
          ]),
        ],

        // ── OB vs Strategy engines ───────────────────────────────────────────
        const SizedBox(height: 12),
        const Divider(color: AppColors.border, height: 1),
        const SizedBox(height: 10),
        const Row(children: [
          Icon(Icons.layers, size: 13, color: AppColors.primary),
          SizedBox(width: 6),
          Text('Engine Signals',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: _EngineSignalTile(
            label: 'Order Blocks',
            action: tech.obAction,
            confidence: tech.obConfidence,
          )),
          const SizedBox(width: 8),
          Expanded(child: _EngineSignalTile(
            label: 'Strategy',
            action: tech.strategyRec,
            confidence: tech.strategyConfidence.toInt(),
          )),
        ]),

        // ── Sentiment ────────────────────────────────────────────────────────
        const SizedBox(height: 12),
        const Divider(color: AppColors.border, height: 1),
        const SizedBox(height: 10),
        Row(children: [
          const Icon(Icons.newspaper, size: 13, color: AppColors.warning),
          const SizedBox(width: 6),
          const Text('Market Sentiment',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
          const Spacer(),
          _SentimentBadge(sentiment: sent.sentiment),
        ]),
        const SizedBox(height: 10),
        _SentimentBar(label: 'News',   score: sent.newsScore),
        const SizedBox(height: 6),
        _SentimentBar(label: 'Social', score: sent.socialScore),
        if (sent.topEvents.isNotEmpty) ...[
          const SizedBox(height: 10),
          ...sent.topEvents.take(3).map((e) => Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('• ',
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
              Expanded(child: Text(e,
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textSecondary, height: 1.4))),
            ]),
          )),
        ],

        // ── Full reasoning ───────────────────────────────────────────────────
        if (sig.reason?.isNotEmpty == true) ...[
          const SizedBox(height: 12),
          const Divider(color: AppColors.border, height: 1),
          const SizedBox(height: 10),
          const Row(children: [
            Icon(Icons.lightbulb_outline, size: 13, color: AppColors.warning),
            SizedBox(width: 6),
            Text('AI Reasoning',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
          ]),
          const SizedBox(height: 6),
          Text(sig.reason!,
              style: const TextStyle(
                  fontSize: 12, color: AppColors.textSecondary, height: 1.5)),
        ],

        // ── Engine badges ────────────────────────────────────────────────────
        const SizedBox(height: 12),
        Wrap(spacing: 6, runSpacing: 6, children: [
          const _EngineBadge(label: 'Order Blocks', active: true),
          const _EngineBadge(label: 'Strategy',     active: true),
          _EngineBadge(label: 'News',         active: sent.articleCount > 0),
          _EngineBadge(label: 'Social',       active: sent.socialScore != 50),
        ]),
      ]),
    );
  }
}

class _ResultStat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _ResultStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Column(children: [
      Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: color)),
      const SizedBox(height: 2),
      Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
    ]));
  }
}

class _EngineSignalTile extends StatelessWidget {
  final String label;
  final String action;
  final int    confidence;
  const _EngineSignalTile({
    required this.label,
    required this.action,
    required this.confidence,
  });

  Color get _color {
    switch (action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: c.withValues(alpha: 0.25)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        const SizedBox(height: 4),
        Row(children: [
          Text(action,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: c)),
          const Spacer(),
          Text('$confidence%',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c)),
        ]),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: confidence / 100,
            minHeight: 3,
            backgroundColor: AppColors.border,
            valueColor: AlwaysStoppedAnimation(c),
          ),
        ),
      ]),
    );
  }
}

class _TradeStat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _TradeStat({
    required this.label,
    required this.value,
    this.color = AppColors.textPrimary,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        const SizedBox(height: 2),
        Text(value,
            style: TextStyle(
                fontSize: 12, fontWeight: FontWeight.w600, color: color)),
      ],
    ));
  }
}

class _EngineBadge extends StatelessWidget {
  final String label;
  final bool   active;
  const _EngineBadge({required this.label, required this.active});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: active
            ? AppColors.primary.withValues(alpha: 0.12)
            : AppColors.surface,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: active ? AppColors.primary.withValues(alpha: 0.4) : AppColors.border,
        ),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(active ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 10,
            color: active ? AppColors.primary : AppColors.textMuted),
        const SizedBox(width: 4),
        Text(label,
            style: TextStyle(
                fontSize: 10,
                fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                color: active ? AppColors.primary : AppColors.textMuted)),
      ]),
    );
  }
}

class _SentimentBadge extends StatelessWidget {
  final String sentiment;
  const _SentimentBadge({required this.sentiment});

  Color get _color {
    switch (sentiment.toLowerCase()) {
      case 'bullish': return AppColors.buy;
      case 'bearish': return AppColors.sell;
      default:        return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: _color.withValues(alpha: 0.4)),
      ),
      child: Text(sentiment.toUpperCase(),
          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: _color)),
    );
  }
}

class _SentimentBar extends StatelessWidget {
  final String label;
  final double score; // 0-100
  const _SentimentBar({required this.label, required this.score});

  Color get _color {
    if (score >= 60) return AppColors.buy;
    if (score <= 40) return AppColors.sell;
    return AppColors.hold;
  }

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      SizedBox(
        width: 52,
        child: Text(label,
            style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
      ),
      Expanded(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: score / 100,
            minHeight: 6,
            backgroundColor: AppColors.border,
            valueColor: AlwaysStoppedAnimation(_color),
          ),
        ),
      ),
      const SizedBox(width: 8),
      Text(score.toStringAsFixed(0),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _color)),
    ]);
  }
}

// ── AI Brain Live Decisions card ──────────────────────────────────────────────

class _AIBrainLiveCard extends ConsumerWidget {
  const _AIBrainLiveCard();

  Color _actionColor(String action) {
    switch (action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  Color _classColor(String cls) {
    switch (cls) {
      case 'commodity': return const Color(0xFFF59E0B);
      case 'forex':     return const Color(0xFF6366F1);
      default:          return AppColors.primary;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(aiBrainLiveProvider);

    if (state.loading && state.decisions.isEmpty) {
      return const SizedBox.shrink();
    }

    final decisions = state.latestPerAsset
        .where((d) => d.action != 'HOLD')
        .take(4)
        .toList();

    if (decisions.isEmpty && !state.loading) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 8, height: 8,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.buy,
              ),
            ),
            const SizedBox(width: 8),
            const Expanded(
              child: Text('AI Brain — Live Decisions',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
            ),
            if (state.lastUpdated != null)
              Text(_timeAgo(state.lastUpdated!),
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: () => ref.read(aiBrainLiveProvider.notifier).load(),
              child: const Icon(Icons.refresh, size: 14, color: AppColors.textSecondary),
            ),
          ]),

          if (decisions.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: decisions.map((d) {
                final ac = _actionColor(d.action);
                final cc = _classColor(d.assetClass);
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: ac.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: ac.withValues(alpha: 0.3)),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Container(
                      width: 6, height: 6,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: cc),
                    ),
                    const SizedBox(width: 6),
                    Text(d.displayName.isEmpty ? d.asset : d.displayName,
                        style: const TextStyle(fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary)),
                    const SizedBox(width: 6),
                    Text(d.action,
                        style: TextStyle(fontSize: 10,
                            fontWeight: FontWeight.w800, color: ac)),
                    const SizedBox(width: 4),
                    Text('${d.confidence}%',
                        style: TextStyle(fontSize: 10, color: ac)),
                    if (d.tradeCreated) ...[
                      const SizedBox(width: 4),
                      const Icon(Icons.check_circle, size: 10, color: AppColors.buy),
                    ],
                  ]),
                );
              }).toList(),
            ),
          ],
        ],
      ),
    );
  }

  String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1)  return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    return '${diff.inHours}h ago';
  }
}

// ── Budget Manager card ───────────────────────────────────────────────────────

const _kBudgetAssets = ['ALL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSD', 'WTI', 'EURUSD'];
const _kRiskLevels   = ['low', 'medium', 'high'];

class _BudgetControlCard extends ConsumerStatefulWidget {
  const _BudgetControlCard();

  @override
  ConsumerState<_BudgetControlCard> createState() => _BudgetControlCardState();
}

class _BudgetControlCardState extends ConsumerState<_BudgetControlCard> {
  final _budgetCtrl = TextEditingController(text: '500');
  String _riskLevel      = 'medium';
  String _preferredAsset = 'ALL';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final session = ref.read(budgetProvider).session;
      if (session != null && mounted) {
        setState(() {
          _budgetCtrl.text = session.budget.toStringAsFixed(0);
          _riskLevel       = session.riskLevel;
          _preferredAsset  = _kBudgetAssets.contains(session.preferredAsset)
              ? session.preferredAsset
              : 'ALL';
        });
      }
    });
  }

  @override
  void dispose() {
    _budgetCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state    = ref.watch(budgetProvider);
    final session  = state.session;
    final perf     = state.performance;
    final isActive = session?.isActive ?? false;
    final accent   = isActive ? AppColors.buy : AppColors.primary;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: 0.35)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [accent.withValues(alpha: 0.06), AppColors.card],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(Icons.account_balance_wallet_outlined,
                  color: accent, size: 18),
            ),
            const SizedBox(width: 10),
            const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('AI Budget Manager',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
              Text('24/7 auto-trading on your behalf',
                  style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
            ])),
            // Status badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: isActive
                    ? AppColors.buy.withValues(alpha: 0.15)
                    : AppColors.textMuted.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: isActive
                        ? AppColors.buy.withValues(alpha: 0.5)
                        : AppColors.border),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 6, height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isActive ? AppColors.buy : AppColors.textMuted,
                  ),
                ),
                const SizedBox(width: 5),
                Text(isActive ? 'ACTIVE' : 'PAUSED',
                    style: TextStyle(
                        fontSize: 10, fontWeight: FontWeight.w700,
                        color: isActive ? AppColors.buy : AppColors.textMuted)),
              ]),
            ),
          ]),

          const SizedBox(height: 14),

          // Error banner
          if (state.error != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.sell.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(children: [
                const Icon(Icons.error_outline, size: 14, color: AppColors.sell),
                const SizedBox(width: 8),
                Expanded(child: Text(state.error!,
                    maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: AppColors.sell))),
              ]),
            ),
            const SizedBox(height: 10),
          ],

          // Budget + Asset row
          Row(children: [
            Expanded(
              flex: 2,
              child: TextField(
                controller: _budgetCtrl,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'Budget (\$)',
                  prefixText: '\$ ',
                  prefixStyle: TextStyle(color: AppColors.textSecondary),
                  contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 3,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: DropdownButton<String>(
                  value: _preferredAsset,
                  isExpanded: true,
                  dropdownColor: AppColors.surface,
                  underline: const SizedBox.shrink(),
                  style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
                  items: _kBudgetAssets.map((a) => DropdownMenuItem(
                    value: a,
                    child: Text(a, style: const TextStyle(fontSize: 13)),
                  )).toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _preferredAsset = v);
                  },
                ),
              ),
            ),
          ]),

          const SizedBox(height: 12),

          // Risk level chips
          Row(children: [
            const Text('Risk:',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(width: 8),
            ..._kRiskLevels.map((level) {
              final selected = _riskLevel == level;
              final color = level == 'low'  ? AppColors.buy
                          : level == 'high' ? AppColors.sell
                          : AppColors.warning;
              return Padding(
                padding: const EdgeInsets.only(right: 6),
                child: GestureDetector(
                  onTap: () => setState(() => _riskLevel = level),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: selected
                          ? color.withValues(alpha: 0.2)
                          : AppColors.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: selected ? color : AppColors.border),
                    ),
                    child: Text(
                      '${level[0].toUpperCase()}${level.substring(1)}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
                        color: selected ? color : AppColors.textSecondary,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ]),

          const SizedBox(height: 14),

          // START / STOP button
          SizedBox(
            width: double.infinity,
            child: state.loading
                ? const Center(child: SizedBox(
                    width: 24, height: 24,
                    child: CircularProgressIndicator(
                        color: AppColors.primary, strokeWidth: 2)))
                : isActive
                    ? OutlinedButton.icon(
                        onPressed: () =>
                            ref.read(budgetProvider.notifier).stop(),
                        icon: const Icon(Icons.stop_circle_outlined, size: 18),
                        label: const Text('Stop AI Manager'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.sell,
                          side: const BorderSide(color: AppColors.sell),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      )
                    : ElevatedButton.icon(
                        onPressed: () {
                          final budget = double.tryParse(_budgetCtrl.text);
                          if (budget == null || budget <= 0) return;
                          ref.read(budgetProvider.notifier).start(
                            budget:         budget,
                            riskLevel:      _riskLevel,
                            preferredAsset: _preferredAsset,
                          );
                        },
                        icon: const Icon(Icons.play_circle_outline, size: 18),
                        label: const Text('Start AI Manager'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.buy,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
          ),

          // Performance mini-stats
          if (perf != null) ...[
            const SizedBox(height: 14),
            const Divider(color: AppColors.border, height: 1),
            const SizedBox(height: 12),
            Row(children: [
              _BudgetStat(
                label: 'Balance',
                value: '\$${perf.currentBalance.toStringAsFixed(0)}',
                color: AppColors.textPrimary,
              ),
              _BudgetStat(
                label: 'Session P&L',
                value: '${perf.sessionPnL >= 0 ? '+' : ''}\$${perf.sessionPnL.toStringAsFixed(2)}',
                color: perf.sessionPnL >= 0 ? AppColors.buy : AppColors.sell,
              ),
              _BudgetStat(
                label: 'Win Rate',
                value: '${perf.winRate.toStringAsFixed(0)}%',
                color: perf.winRate >= 50 ? AppColors.buy : AppColors.sell,
              ),
              _BudgetStat(
                label: 'Active',
                value: '${perf.activeTrades} trades',
                color: AppColors.primary,
              ),
            ]),
          ],
        ],
      ),
    );
  }
}

class _BudgetStat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _BudgetStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(value,
            style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w700, color: color)),
        const SizedBox(height: 2),
        Text(label,
            style: const TextStyle(
                fontSize: 10, color: AppColors.textSecondary)),
      ],
    ));
  }
}

// ──────────────────────────────────────────────────────────────────────────────

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
