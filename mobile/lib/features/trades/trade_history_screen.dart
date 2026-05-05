import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/providers/prices_provider.dart';
import '../../core/theme/app_theme.dart';

class TradeHistoryScreen extends ConsumerStatefulWidget {
  const TradeHistoryScreen({super.key});

  @override
  ConsumerState<TradeHistoryScreen> createState() =>
      _TradeHistoryScreenState();
}

class _TradeHistoryScreenState extends ConsumerState<TradeHistoryScreen> {
  String _filter = 'ALL'; // ALL / OPEN / WIN / LOSS / CANCELLED

  @override
  Widget build(BuildContext context) {
    final state  = ref.watch(followsProvider);
    final prices = ref.watch(pricesProvider);

    var items = state.follows;
    if (_filter == 'OPEN') {
      items = items.where((f) => f.isOpen).toList();
    } else if (_filter != 'ALL') {
      items = items.where((f) => f.outcome == _filter).toList();
    }

    // Stats from ALL trades
    final all     = state.follows;
    final closed  = all.where((f) => f.outcome == 'WIN' || f.outcome == 'LOSS').toList();
    final wins    = closed.where((f) => f.outcome == 'WIN').length;
    final withPnl = closed.where((f) => f.profitPct != null).toList();
    final avgPnl  = withPnl.isEmpty
        ? null
        : withPnl.map((f) => f.profitPct!).reduce((a, b) => a + b) / withPnl.length;
    final bestPnl = withPnl.isEmpty
        ? null
        : withPnl.map((f) => f.profitPct!).reduce((a, b) => a > b ? a : b);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        title: Row(children: [
          const Text('Trade Journal',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text('${all.length}',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                    color: AppColors.primary)),
          ),
        ]),
        actions: [
          if (state.loading)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: SizedBox(width: 18, height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2,
                      color: AppColors.primary)),
            ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () => ref.read(followsProvider.notifier).fetch(),
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            // ── Stats row ────────────────────────────────────────────────
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: _StatsBar(
                  openCount:  all.where((f) => f.isOpen).length,
                  wins:       wins,
                  losses:     closed.length - wins,
                  winRate:    closed.isEmpty ? null
                      : (wins * 100 ~/ closed.length),
                  avgPnl:     avgPnl,
                  bestPnl:    bestPnl,
                ),
              ),
            ),

            // ── Filter chips ─────────────────────────────────────────────
            SliverToBoxAdapter(
              child: _FilterBar(
                current:   _filter,
                openCount: all.where((f) => f.isOpen).length,
                winCount:  wins,
                lossCount: closed.length - wins,
                total:     all.length,
                onChanged: (v) => setState(() => _filter = v),
              ),
            ),

            // ── Empty state ──────────────────────────────────────────────
            if (items.isEmpty)
              SliverFillRemaining(
                child: Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.history_edu_outlined,
                        size: 52, color: AppColors.textMuted),
                    const SizedBox(height: 12),
                    Text(
                      _filter == 'ALL'
                          ? 'No trades yet'
                          : 'No $_filter trades',
                      style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Follow a signal from Brain or Scanner\nto start tracking trades.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 13, color: AppColors.textMuted, height: 1.5),
                    ),
                  ]),
                ),
              )
            else
              // ── Trade list ─────────────────────────────────────────────
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (_, i) => _TradeTile(
                      follow: items[i],
                      livePrice: prices[items[i].asset],
                    ),
                    childCount: items.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

class _StatsBar extends StatelessWidget {
  final int    openCount;
  final int    wins;
  final int    losses;
  final int?   winRate;
  final double? avgPnl;
  final double? bestPnl;

  const _StatsBar({
    required this.openCount, required this.wins, required this.losses,
    this.winRate, this.avgPnl, this.bestPnl,
  });

  @override
  Widget build(BuildContext context) {
    final total = wins + losses;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: [
        Row(children: [
          _Stat(label: 'Open',     value: '$openCount', color: AppColors.hold),
          _Stat(label: 'Wins',     value: '$wins',      color: AppColors.buy),
          _Stat(label: 'Losses',   value: '$losses',    color: AppColors.sell),
          if (winRate != null)
            _Stat(
              label: 'Win Rate',
              value: '$winRate%',
              color: winRate! >= 50 ? AppColors.buy : AppColors.sell,
            ),
          if (avgPnl != null)
            _Stat(
              label: 'Avg P&L',
              value: '${avgPnl! >= 0 ? '+' : ''}${avgPnl!.toStringAsFixed(1)}%',
              color: avgPnl! >= 0 ? AppColors.buy : AppColors.sell,
            ),
          if (bestPnl != null)
            _Stat(
              label: 'Best',
              value: '+${bestPnl!.toStringAsFixed(1)}%',
              color: AppColors.buy,
            ),
        ]),
        if (total > 0) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Row(children: [
              if (wins   > 0) Flexible(flex: wins,   child: Container(height: 4, color: AppColors.buy)),
              if (losses > 0) Flexible(flex: losses, child: Container(height: 4, color: AppColors.sell)),
            ]),
          ),
        ],
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _Stat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      Text(value,
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
      Text(label,
          style: const TextStyle(fontSize: 9, color: AppColors.textMuted,
              letterSpacing: 0.8)),
    ]),
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

class _FilterBar extends StatelessWidget {
  final String current;
  final int    openCount, winCount, lossCount, total;
  final void Function(String) onChanged;

  const _FilterBar({
    required this.current,   required this.openCount,
    required this.winCount,  required this.lossCount,
    required this.total,     required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 44,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      children: [
        _Chip('ALL',    total,     AppColors.primary, current, onChanged),
        _Chip('OPEN',   openCount, AppColors.hold,    current, onChanged),
        _Chip('WIN',    winCount,  AppColors.buy,     current, onChanged),
        _Chip('LOSS',   lossCount, AppColors.sell,    current, onChanged),
      ],
    ),
  );
}

class _Chip extends StatelessWidget {
  final String label, current;
  final int    count;
  final Color  color;
  final void Function(String) onTap;
  const _Chip(this.label, this.count, this.color, this.current, this.onTap);

  @override
  Widget build(BuildContext context) {
    final sel = label == current;
    return GestureDetector(
      onTap: () => onTap(label),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: sel ? color.withValues(alpha: 0.15) : AppColors.card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: sel ? color : AppColors.border),
        ),
        child: Center(
          child: Text('$label  $count',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: sel ? FontWeight.w700 : FontWeight.normal,
                  color: sel ? color : AppColors.textSecondary)),
        ),
      ),
    );
  }
}

// ── Trade tile ────────────────────────────────────────────────────────────────

class _TradeTile extends ConsumerWidget {
  final UserFollow follow;
  final double?    livePrice;
  const _TradeTile({required this.follow, this.livePrice});

  Color get _outcomeColor {
    switch (follow.outcome) {
      case 'WIN':  return AppColors.buy;
      case 'LOSS': return AppColors.sell;
      case 'OPEN': return AppColors.hold;
      default:     return AppColors.textMuted;
    }
  }

  Color get _actionColor =>
      follow.action == 'BUY' ? AppColors.buy
      : follow.action == 'SELL' ? AppColors.sell : AppColors.hold;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Compute live P&L for open trades
    double? displayPnl = follow.profitPct;
    if (follow.isOpen && follow.entryPrice != null && livePrice != null) {
      final raw = (livePrice! - follow.entryPrice!) / follow.entryPrice! * 100;
      displayPnl = follow.action == 'SELL' ? -raw : raw;
    }

    final tile = Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: _outcomeColor.withValues(alpha: 0.3),
        ),
      ),
      child: Row(children: [
        // Asset circle
        _AssetCircle(asset: follow.asset),
        const SizedBox(width: 12),

        // Main info
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(follow.displayName,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
              const SizedBox(width: 8),
              _Badge(follow.action, _actionColor),
              const SizedBox(width: 6),
              _Badge(follow.outcome, _outcomeColor),
            ]),
            const SizedBox(height: 4),
            Row(children: [
              if (follow.entryPrice != null) ...[
                Text('Entry ${_fmt(follow.entryPrice!)}',
                    style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                if (follow.exitPrice != null) ...[
                  const Text(' → ',
                      style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                  Text(_fmt(follow.exitPrice!),
                      style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                ] else if (livePrice != null) ...[
                  const Text(' → ',
                      style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                  Text(_fmt(livePrice!),
                      style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                ],
              ],
              const Spacer(),
              Text(_duration(follow.createdAt, follow.closedAt),
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ]),
            const SizedBox(height: 2),
            Text(_date(follow.createdAt),
                style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
          ]),
        ),

        // P&L chip
        if (displayPnl != null) ...[
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
            decoration: BoxDecoration(
              color: (displayPnl >= 0 ? AppColors.buy : AppColors.sell)
                  .withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: (displayPnl >= 0 ? AppColors.buy : AppColors.sell)
                    .withValues(alpha: 0.3),
              ),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(
                '${displayPnl >= 0 ? '+' : ''}${displayPnl.toStringAsFixed(1)}%',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: displayPnl >= 0 ? AppColors.buy : AppColors.sell),
              ),
              if (follow.isOpen)
                Text('LIVE',
                    style: TextStyle(
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                        color: (displayPnl >= 0 ? AppColors.buy : AppColors.sell)
                            .withValues(alpha: 0.7),
                        letterSpacing: 0.5)),
            ]),
          ),
        ],
      ]),
    );

    // Closed trades can be swiped away
    if (!follow.isOpen) {
      return Dismissible(
        key: ValueKey(follow.id),
        direction: DismissDirection.endToStart,
        background: Container(
          margin: const EdgeInsets.only(bottom: 8),
          decoration: BoxDecoration(
            color: AppColors.sell.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(14),
          ),
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          child: const Icon(Icons.delete_outline, color: AppColors.sell, size: 22),
        ),
        onDismissed: (_) {
          HapticFeedback.mediumImpact();
          ref.read(followsProvider.notifier).removeTrade(follow.id);
        },
        child: tile,
      );
    }
    return tile;
  }

  String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }

  String _date(DateTime dt) {
    final d = dt;
    return '${d.day}/${d.month}/${d.year}';
  }

  String _duration(DateTime start, DateTime? end) {
    final diff = (end ?? DateTime.now()).difference(start);
    if (diff.inMinutes < 60)  return '${diff.inMinutes}m';
    if (diff.inHours   < 24)  return '${diff.inHours}h';
    return '${diff.inDays}d';
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color  color;
  const _Badge(this.label, this.color);

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(4),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(label,
        style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: color)),
  );
}

// ── Asset circle (local copy) ─────────────────────────────────────────────────

class _AssetCircle extends StatelessWidget {
  final String asset;
  const _AssetCircle({required this.asset});

  static const _colors = [
    Color(0xFFF7931A), Color(0xFF627EEA), Color(0xFFF3BA2F),
    Color(0xFF9945FF), Color(0xFF00AAE4), Color(0xFF0033AD),
    Color(0xFFBA9F33), Color(0xFFE84142), Color(0xFF2A5ADA),
    Color(0xFF8247E5),
  ];

  @override
  Widget build(BuildContext context) {
    final sym   = asset.toUpperCase().replaceAll('USDT', '');
    final color = _colors[sym.codeUnits.fold(0, (a, b) => a + b) % _colors.length];
    return Container(
      width: 42, height: 42,
      decoration: BoxDecoration(
        color:  color.withValues(alpha: 0.15),
        shape:  BoxShape.circle,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Center(
        child: Text(
          sym.length > 3 ? sym.substring(0, 3) : sym,
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color),
        ),
      ),
    );
  }
}
