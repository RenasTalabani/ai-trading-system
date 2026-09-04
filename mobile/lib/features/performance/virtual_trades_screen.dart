import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/virtual_portfolio_provider.dart';
import '../../core/providers/exposure_provider.dart';
import '../../core/providers/benchmark_provider.dart';
import '../../core/models/virtual_portfolio_model.dart';
import '../../core/models/exposure_model.dart';
import '../../core/theme/app_theme.dart';

class VirtualTradesScreen extends ConsumerStatefulWidget {
  const VirtualTradesScreen({super.key});

  @override
  ConsumerState<VirtualTradesScreen> createState() => _VirtualTradesScreenState();
}

class _VirtualTradesScreenState extends ConsumerState<VirtualTradesScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) _onTabChanged(_tabController.index);
    });
  }

  void _onTabChanged(int index) {
    final status = switch (index) {
      1 => 'open',
      2 => 'closed',
      _ => null,
    };
    ref.read(virtualTradesProvider.notifier).fetch(page: 1, status: status);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Trade History'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.primary,
          labelColor: AppColors.primary,
          unselectedLabelColor: AppColors.textSecondary,
          tabs: const [
            Tab(text: 'All'),
            Tab(text: 'Open'),
            Tab(text: 'Closed'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          _TradeList(status: null),
          _TradeList(status: 'open'),
          _TradeList(status: 'closed'),
        ],
      ),
    );
  }
}

class _TradeList extends ConsumerWidget {
  final String? status;
  const _TradeList({this.status});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(virtualTradesProvider);

    if (state.loading && state.trades.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.trades.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bar_chart_outlined, size: 48, color: AppColors.textSecondary),
            SizedBox(height: 12),
            Text('No trades yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 16)),
          ],
        ),
      );
    }

    final showExposure = status == 'open';
    // Decision #22's benchmark is about overall trading performance, not
    // currently-open exposure -- shown on the "All" tab instead.
    final showBenchmark = status == null;
    final headerCount = (showExposure || showBenchmark) ? 1 : 0;

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async {
        await ref.read(virtualTradesProvider.notifier).fetch(page: 1, status: status);
        if (showExposure) await ref.read(exposureProvider.notifier).refresh();
        if (showBenchmark) await ref.read(benchmarkProvider.notifier).fetch();
      },
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: headerCount + state.trades.length + (state.page < state.pages ? 1 : 0),
        itemBuilder: (context, index) {
          if (showExposure && index == 0) {
            return const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: _ExposureCard(),
            );
          }
          if (showBenchmark && index == 0) {
            return const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: _BenchmarkCard(),
            );
          }
          final i = index - headerCount;
          if (i == state.trades.length) {
            return _LoadMoreButton(
              loading: state.loading,
              onTap: () => ref.read(virtualTradesProvider.notifier).fetch(
                    page: state.page + 1, status: status),
            );
          }
          return _TradeCard(trade: state.trades[i]);
        },
      ),
    );
  }
}

// ─── Portfolio exposure summary ────────────────────────────────────────────────

class _ExposureCard extends ConsumerWidget {
  const _ExposureCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(exposureProvider);

    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (exposure) {
        if (exposure.openPositions == 0) return const SizedBox.shrink();

        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Portfolio Exposure',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textMuted)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: _ExposureStat(
                  label: 'Total Exposure',
                  value: '\$${exposure.totalNotionalUsd.toStringAsFixed(0)}')),
              Expanded(child: _ExposureStat(
                  label: '% of Balance',
                  value: '${exposure.exposurePctOfBalance.toStringAsFixed(0)}%',
                  color: exposure.exposurePctOfBalance > 100 ? AppColors.error : null)),
              Expanded(child: _ExposureStat(
                  label: 'Open Positions',
                  value: '${exposure.openPositions}')),
            ]),
            if (exposure.byAsset.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(spacing: 6, runSpacing: 6, children: exposure.byAsset.map((a) =>
                _AssetChip(exposure: a)).toList()),
            ],
            if (exposure.concentratedDirectionWarning) ...[
              const SizedBox(height: 10),
              _WarningRow(
                icon: Icons.warning_amber_rounded,
                text: 'All open positions are ${exposure.dominantDirection} — '
                    'this is effectively one large directional bet, not a diversified portfolio.',
              ),
            ],
            if (exposure.nearLiquidationCount > 0) ...[
              const SizedBox(height: 8),
              _WarningRow(
                icon: Icons.bolt,
                text: '${exposure.nearLiquidationCount} futures position(s) are within 5% of liquidation.',
              ),
            ],
          ]),
        );
      },
    );
  }
}

// ─── Buy-and-hold BTC benchmark (decision #22 graduation criterion) ────────────
// Informational only -- states the two facts the plan asks for (elapsed
// time, benchmark comparison) and never tells the user "go live now". That
// call belongs to the founder, same as every other consequential decision
// in this app.
class _BenchmarkCard extends ConsumerWidget {
  const _BenchmarkCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(benchmarkProvider);

    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (b) {
        if (!b.available) return const SizedBox.shrink();

        final outperforming = b.outperformingBenchmark ?? false;
        final resultColor = outperforming ? AppColors.success : AppColors.error;
        final portfolioPct = b.portfolioReturnPct ?? 0;
        final benchmarkPct = b.benchmarkReturnPct ?? 0;

        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('vs. Buy & Hold BTC',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textMuted)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: _ExposureStat(
                  label: 'Your Return',
                  value: '${portfolioPct >= 0 ? '+' : ''}${portfolioPct.toStringAsFixed(1)}%',
                  color: portfolioPct >= 0 ? AppColors.success : AppColors.error)),
              Expanded(child: _ExposureStat(
                  label: 'BTC Buy & Hold',
                  value: '${benchmarkPct >= 0 ? '+' : ''}${benchmarkPct.toStringAsFixed(1)}%')),
              Expanded(child: _ExposureStat(
                  label: 'Weeks Trading',
                  value: b.weeksElapsed != null ? b.weeksElapsed!.toStringAsFixed(1) : '—')),
            ]),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: resultColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(outperforming ? Icons.trending_up : Icons.trending_down, size: 15, color: resultColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    outperforming
                        ? "You're beating simple Buy & Hold BTC right now."
                        : 'Buy & Hold BTC is currently ahead of your paper trading.',
                    style: TextStyle(fontSize: 12, color: resultColor, height: 1.4),
                  ),
                ),
              ]),
            ),
            const SizedBox(height: 8),
            Text(
              b.graduationCriteriaMet == true
                  ? 'Both graduation conditions from the plan (4+ weeks, beating this benchmark) are currently met — this is information, not an instruction to switch to real money.'
                  : 'Graduating to real money (per the plan) needs at least 4 weeks of paper trading AND beating this benchmark — not there yet.',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 11, height: 1.4),
            ),
          ]),
        );
      },
    );
  }
}

class _ExposureStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _ExposureStat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
    const SizedBox(height: 2),
    Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold,
        color: color ?? AppColors.textPrimary)),
  ]);
}

class _AssetChip extends StatelessWidget {
  final AssetExposure exposure;
  const _AssetChip({required this.exposure});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      '${exposure.asset.replaceAll('USDT', '')} ${exposure.concentrationPct.toStringAsFixed(0)}%',
      style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
    ),
  );
}

class _WarningRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _WarningRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: AppColors.hold.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(icon, size: 15, color: AppColors.hold),
      const SizedBox(width: 8),
      Expanded(child: Text(text,
          style: const TextStyle(fontSize: 11.5, color: AppColors.textSecondary, height: 1.3))),
    ]),
  );
}

// ─── Trade card ───────────────────────────────────────────────────────────────

class _TradeCard extends StatelessWidget {
  final VirtualTradeModel trade;
  const _TradeCard({required this.trade});

  @override
  Widget build(BuildContext context) {
    final isOpen = trade.isOpen;
    final isBuy  = trade.isBuy;
    final isWin  = trade.isWin;
    final pnl    = trade.pnl;
    final pnlPct = trade.pnlPct;

    Color statusColor;
    String statusLabel;
    if (isOpen) {
      statusColor = AppColors.primary;
      statusLabel = 'OPEN';
    } else if (trade.status == 'cancelled') {
      statusColor = AppColors.textMuted;
      statusLabel = 'EXPIRED';
    } else if (isWin) {
      statusColor = AppColors.success;
      statusLabel = 'WIN';
    } else {
      statusColor = AppColors.error;
      statusLabel = 'LOSS';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Header row ───────────────────────────────────────────────────
            Row(children: [
              _DirectionBadge(isBuy: isBuy),
              const SizedBox(width: 8),
              Text(trade.baseAsset,
                  style: const TextStyle(fontWeight: FontWeight.bold,
                      fontSize: 15, color: AppColors.textPrimary)),
              const SizedBox(width: 4),
              const Text('USDT',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              if (trade.isFutures) ...[
                const SizedBox(width: 6),
                _LeverageBadge(leverage: trade.leverage),
              ],
              if ((trade.sizeMultiplier - 1.0).abs() > 0.05) ...[
                const SizedBox(width: 6),
                _EdgeBadge(multiplier: trade.sizeMultiplier),
              ],
              const Spacer(),
              // Exit reason badge (TP / SL / EXPIRED) shown only on closed trades
              if (trade.exitReason != null && !isOpen) ...[
                _ExitReasonBadge(reason: trade.exitReason!),
                const SizedBox(width: 6),
              ],
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(statusLabel,
                    style: TextStyle(color: statusColor,
                        fontSize: 11, fontWeight: FontWeight.bold)),
              ),
            ]),

            const SizedBox(height: 10),

            // ── Price row ─────────────────────────────────────────────────────
            Wrap(spacing: 12, runSpacing: 6, children: [
              _InfoChip(label: 'Entry', value: _price(trade.entryPrice)),
              if (trade.exitPrice != null)
                _InfoChip(label: 'Exit', value: _price(trade.exitPrice!)),
              if (trade.exitPrice == null && trade.stopLoss != null)
                _InfoChip(label: 'SL', value: _price(trade.stopLoss!)),
              if (trade.exitPrice == null && trade.takeProfit != null)
                _InfoChip(label: 'TP', value: _price(trade.takeProfit!)),
              if (trade.exitPrice == null && trade.isFutures && trade.liquidationPrice != null)
                _InfoChip(label: 'Liq', value: _price(trade.liquidationPrice!)),
            ]),

            const SizedBox(height: 10),

            // ── Balance before → after (closed only) ─────────────────────────
            if (!isOpen && trade.balanceBefore != null && trade.balanceAfter != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(children: [
                  const Icon(Icons.account_balance_wallet_outlined,
                      size: 12, color: AppColors.textMuted),
                  const SizedBox(width: 4),
                  Text('\$${trade.balanceBefore!.toStringAsFixed(2)}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4),
                    child: Icon(Icons.arrow_forward, size: 10, color: AppColors.textMuted),
                  ),
                  Text('\$${trade.balanceAfter!.toStringAsFixed(2)}',
                      style: TextStyle(
                        color: trade.balanceAfter! >= trade.balanceBefore!
                            ? AppColors.buy : AppColors.sell,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      )),
                ]),
              ),

            // ── Bottom row ────────────────────────────────────────────────────
            Row(children: [
              Text('Size: \$${trade.sizeUsd.toStringAsFixed(2)}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              if (trade.durationLabel.isNotEmpty) ...[
                const SizedBox(width: 8),
                const Icon(Icons.timer_outlined, size: 12, color: AppColors.textMuted),
                const SizedBox(width: 2),
                Text(trade.durationLabel,
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
              ],
              if (trade.isFutures && trade.fundingPaid != 0) ...[
                const SizedBox(width: 8),
                Text(
                  'Funding: ${trade.fundingPaid >= 0 ? '+' : ''}\$${trade.fundingPaid.toStringAsFixed(2)}',
                  style: TextStyle(
                    color: trade.fundingPaid >= 0 ? AppColors.success : AppColors.error,
                    fontSize: 11,
                  ),
                ),
              ],
              const Spacer(),
              if (!isOpen && pnl != null && pnlPct != null) ...[
                Text(
                  '${pnl >= 0 ? '+' : ''}\$${pnl.toStringAsFixed(2)}',
                  style: TextStyle(
                    color: pnl >= 0 ? AppColors.success : AppColors.error,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  '(${pnlPct >= 0 ? '+' : ''}${pnlPct.toStringAsFixed(2)}%)',
                  style: TextStyle(
                    color: pnl >= 0 ? AppColors.success : AppColors.error,
                    fontSize: 12,
                  ),
                ),
              ],
              if (isOpen) ...[
                _TrailingStopToggle(trade: trade),
                const SizedBox(width: 8),
                Text(_timeAgo(trade.openedAt),
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ],
            ]),
          ],
        ),
      ),
    );
  }

  String _price(double v) => v >= 1000
      ? v.toStringAsFixed(0)
      : v >= 1
          ? v.toStringAsFixed(2)
          : v.toStringAsFixed(5);

  String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inDays > 0)    return '${diff.inDays}d ago';
    if (diff.inHours > 0)   return '${diff.inHours}h ago';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m ago';
    return 'just now';
  }
}

// ─── Exit reason badge ────────────────────────────────────────────────────────

class _ExitReasonBadge extends StatelessWidget {
  final String reason;
  const _ExitReasonBadge({required this.reason});

  @override
  Widget build(BuildContext context) {
    final color = switch (reason) {
      'TP'         => AppColors.buy,
      'SL'         => AppColors.sell,
      'LIQUIDATED' => AppColors.error,
      'EXPIRED'    => AppColors.textMuted,
      _            => AppColors.textMuted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(reason,
          style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
    );
  }
}

// ─── Trailing stop-loss toggle (open trades only) ─────────────────────────────

class _TrailingStopToggle extends ConsumerStatefulWidget {
  final VirtualTradeModel trade;
  const _TrailingStopToggle({required this.trade});

  @override
  ConsumerState<_TrailingStopToggle> createState() => _TrailingStopToggleState();
}

class _TrailingStopToggleState extends ConsumerState<_TrailingStopToggle> {
  bool _loading = false;

  Future<void> _enable() async {
    setState(() => _loading = true);
    try {
      await ref.read(virtualTradesProvider.notifier).enableTrailingStop(widget.trade.id);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Failed to enable trailing stop: $e'),
          backgroundColor: AppColors.error,
        ));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.trade.trailingStopEnabled;
    if (_loading) {
      return const SizedBox(width: 14, height: 14,
          child: CircularProgressIndicator(strokeWidth: 2));
    }
    return GestureDetector(
      onTap: enabled ? null : _enable,
      child: Tooltip(
        message: enabled
            ? 'Trailing stop active — locks in gains as price moves favorably'
            : 'Enable trailing stop-loss',
        child: Icon(
          Icons.trending_up,
          size: 16,
          color: enabled ? AppColors.success : AppColors.textMuted,
        ),
      ),
    );
  }
}

// ─── Leverage badge (paper futures only) ──────────────────────────────────────

class _LeverageBadge extends StatelessWidget {
  final int leverage;
  const _LeverageBadge({required this.leverage});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.hold.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppColors.hold.withValues(alpha: 0.4)),
      ),
      child: Text('${leverage}x',
          style: const TextStyle(color: AppColors.hold, fontSize: 10, fontWeight: FontWeight.bold)),
    );
  }
}

// ─── Edge-based sizing badge — shown when this position was sized up/down ────
// from the baseline risk% because this asset has a proven recent win/loss edge.

class _EdgeBadge extends StatelessWidget {
  final double multiplier;
  const _EdgeBadge({required this.multiplier});

  @override
  Widget build(BuildContext context) {
    final boosted = multiplier > 1.0;
    final color = boosted ? AppColors.success : AppColors.error;
    return Tooltip(
      message: boosted
          ? 'Sized up — this asset has a proven recent edge'
          : 'Sized down — this asset has been underperforming recently',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Text('${multiplier.toStringAsFixed(1)}x size',
            style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
      ),
    );
  }
}

// ─── Reusable widgets ─────────────────────────────────────────────────────────

class _DirectionBadge extends StatelessWidget {
  final bool isBuy;
  const _DirectionBadge({required this.isBuy});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: (isBuy ? AppColors.success : AppColors.error).withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        isBuy ? 'BUY' : 'SELL',
        style: TextStyle(
          color: isBuy ? AppColors.success : AppColors.error,
          fontSize: 11,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final String label;
  final String value;
  const _InfoChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(children: [
        TextSpan(text: '$label: ',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        TextSpan(text: value,
            style: const TextStyle(color: AppColors.textPrimary, fontSize: 12)),
      ]),
    );
  }
}

class _LoadMoreButton extends StatelessWidget {
  final bool loading;
  final VoidCallback onTap;
  const _LoadMoreButton({required this.loading, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: loading
            ? const SizedBox(width: 24, height: 24,
                child: CircularProgressIndicator(strokeWidth: 2))
            : OutlinedButton(onPressed: onTap, child: const Text('Load more')),
      ),
    );
  }
}
