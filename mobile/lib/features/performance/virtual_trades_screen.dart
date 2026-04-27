import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/virtual_portfolio_provider.dart';
import '../../core/models/virtual_portfolio_model.dart';
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

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => ref.read(virtualTradesProvider.notifier).fetch(
            page: 1, status: status),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: state.trades.length + (state.page < state.pages ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == state.trades.length) {
            return _LoadMoreButton(
              loading: state.loading,
              onTap: () => ref.read(virtualTradesProvider.notifier).fetch(
                    page: state.page + 1, status: status),
            );
          }
          return _TradeCard(trade: state.trades[index]);
        },
      ),
    );
  }
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
            Row(children: [
              _InfoChip(label: 'Entry', value: _price(trade.entryPrice)),
              if (trade.exitPrice != null) ...[
                const SizedBox(width: 8),
                _InfoChip(label: 'Exit', value: _price(trade.exitPrice!)),
              ],
              if (trade.exitPrice == null && trade.stopLoss != null) ...[
                const SizedBox(width: 8),
                _InfoChip(label: 'SL', value: _price(trade.stopLoss!)),
              ],
              if (trade.exitPrice == null && trade.takeProfit != null) ...[
                const SizedBox(width: 8),
                _InfoChip(label: 'TP', value: _price(trade.takeProfit!)),
              ],
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
              if (isOpen)
                Text(_timeAgo(trade.openedAt),
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
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
      'TP'      => AppColors.buy,
      'SL'      => AppColors.sell,
      'EXPIRED' => AppColors.textMuted,
      _         => AppColors.textMuted,
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
