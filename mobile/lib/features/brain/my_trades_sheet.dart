import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';

void showMyTradesSheet(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => const _MyTradesSheet(),
  );
}

class _MyTradesSheet extends ConsumerWidget {
  const _MyTradesSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(followsProvider);
    final open   = state.follows.where((f) => f.isOpen).toList();
    final closed = state.follows.where((f) => !f.isOpen).toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (_, ctrl) => Column(children: [
        // Handle
        const SizedBox(height: 12),
        Container(width: 40, height: 4,
            decoration: BoxDecoration(color: AppColors.border,
                borderRadius: BorderRadius.circular(2))),
        const SizedBox(height: 16),

        // Header
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(children: [
            const Text('My Trades',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text('${state.follows.length}',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                      color: AppColors.primary)),
            ),
            const Spacer(),
            if (state.loading)
              const SizedBox(width: 16, height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2,
                      color: AppColors.primary)),
          ]),
        ),
        const SizedBox(height: 10),

        // Stats row
        if (state.follows.isNotEmpty) _StatsRow(follows: state.follows),

        const SizedBox(height: 4),

        // Content
        Expanded(
          child: state.follows.isEmpty
              ? const Center(child: Column(
                  mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.inbox_outlined, size: 48, color: AppColors.textMuted),
                    SizedBox(height: 12),
                    Text('No trades followed yet',
                        style: TextStyle(color: AppColors.textSecondary)),
                    SizedBox(height: 6),
                    Text('Tap "Follow This Trade" on the Brain screen',
                        style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
                  ],
                ))
              : ListView(controller: ctrl, padding: const EdgeInsets.all(16), children: [
                  if (open.isNotEmpty) ...[
                    const _SheetLabel('OPEN'),
                    const SizedBox(height: 8),
                    ...open.map((f) => _FollowTile(follow: f)),
                    const SizedBox(height: 16),
                  ],
                  if (closed.isNotEmpty) ...[
                    const _SheetLabel('CLOSED'),
                    const SizedBox(height: 8),
                    ...closed.map((f) => _FollowTile(follow: f)),
                  ],
                ]),
        ),
      ]),
    );
  }
}

// ── Follow tile ───────────────────────────────────────────────────────────────

class _FollowTile extends ConsumerWidget {
  final UserFollow follow;
  const _FollowTile({required this.follow});

  Color get _outcomeColor {
    switch (follow.outcome) {
      case 'WIN':  return AppColors.buy;
      case 'LOSS': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  Color get _actionColor => follow.action == 'BUY' ? AppColors.buy
      : follow.action == 'SELL' ? AppColors.sell : AppColors.hold;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tile = Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _outcomeColor.withValues(alpha: 0.3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          // Outcome badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: _outcomeColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(follow.outcome,
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800,
                    color: _outcomeColor)),
          ),
          const SizedBox(width: 10),
          Text(follow.displayName,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: _actionColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(follow.action,
                style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                    color: _actionColor)),
          ),
          const Spacer(),
          if (follow.profitPct != null)
            Text(
              '${follow.profitPct! >= 0 ? '+' : ''}${follow.profitPct!.toStringAsFixed(1)}%',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: follow.profitPct! >= 0 ? AppColors.buy : AppColors.sell),
            ),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          Text('${follow.confidence}% conf',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              color: AppColors.border,
              borderRadius: BorderRadius.circular(3),
            ),
            child: Text(follow.timeframe,
                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700,
                    color: AppColors.textMuted)),
          ),
          if (follow.entryPrice != null) ...[
            const SizedBox(width: 8),
            Text('Entry \$${_fmt(follow.entryPrice!)}',
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ],
          const Spacer(),
          Text(_date(follow.createdAt),
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ]),

        // Close buttons for open trades
        if (follow.isOpen) ...[
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: _CloseBtn(
              label: 'WIN',
              color: AppColors.buy,
              onTap: () => _close(context, ref, 'WIN'),
            )),
            const SizedBox(width: 8),
            Expanded(child: _CloseBtn(
              label: 'LOSS',
              color: AppColors.sell,
              onTap: () => _close(context, ref, 'LOSS'),
            )),
            const SizedBox(width: 8),
            _CloseBtn(
              label: 'Cancel',
              color: AppColors.textMuted,
              onTap: () => _close(context, ref, 'CANCELLED'),
            ),
          ]),
        ],
      ]),
    );

    // Closed trades can be swiped away to remove
    if (!follow.isOpen) {
      return Dismissible(
        key: ValueKey(follow.id),
        direction: DismissDirection.endToStart,
        background: Container(
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(
            color: AppColors.sell.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(14),
          ),
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          child: const Icon(Icons.delete_outline, color: AppColors.sell, size: 22),
        ),
        onDismissed: (_) =>
            ref.read(followsProvider.notifier).removeTrade(follow.id),
        child: tile,
      );
    }
    return tile;
  }

  Future<void> _close(BuildContext context, WidgetRef ref, String outcome) async {
    if (outcome == 'CANCELLED') {
      await ref.read(followsProvider.notifier)
          .closeTrade(follow.id, outcome: outcome);
      return;
    }

    // Ask for exit price to auto-calculate profit %
    final priceCtrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.card,
        title: Text(
          outcome == 'WIN' ? '✅ Mark as WIN' : '❌ Mark as LOSS',
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 16,
              fontWeight: FontWeight.w700),
        ),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Exit price (optional):',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 10),
          TextField(
            controller: priceCtrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(color: AppColors.textPrimary),
            decoration: const InputDecoration(
              hintText: 'e.g. 68500',
              prefixText: '\$ ',
              prefixStyle: TextStyle(color: AppColors.textMuted),
            ),
            autofocus: true,
          ),
        ]),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: outcome == 'WIN' ? AppColors.buy : AppColors.sell,
              minimumSize: Size.zero,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            ),
            onPressed: () => Navigator.pop(context, true),
            child: Text(outcome,
                style: const TextStyle(color: Colors.white,
                    fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final exitPrice = double.tryParse(priceCtrl.text.trim());
    double? profitPct;
    if (exitPrice != null && follow.entryPrice != null && follow.entryPrice! > 0) {
      final diff = exitPrice - follow.entryPrice!;
      profitPct = (diff / follow.entryPrice!) * 100;
      if (follow.action == 'SELL') profitPct = -profitPct;
      profitPct = double.parse(profitPct.toStringAsFixed(2));
    }

    await ref.read(followsProvider.notifier).closeTrade(
      follow.id,
      outcome:   outcome,
      exitPrice: exitPrice,
      profitPct: profitPct,
    );
  }

  String _fmt(double v) {
    if (v >= 10000) return v.toStringAsFixed(0);
    if (v >= 100)   return v.toStringAsFixed(1);
    return v.toStringAsFixed(2);
  }

  String _date(DateTime dt) {
    final d = DateTime.now().difference(dt);
    if (d.inMinutes < 60)  return '${d.inMinutes}m ago';
    if (d.inHours   < 24)  return '${d.inHours}h ago';
    return '${d.inDays}d ago';
  }
}

class _CloseBtn extends StatelessWidget {
  final String label;
  final Color  color;
  final VoidCallback onTap;
  const _CloseBtn({required this.label, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(label,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
              color: color)),
    ),
  );
}

class _SheetLabel extends StatelessWidget {
  final String text;
  const _SheetLabel(this.text);

  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
          color: AppColors.textMuted, letterSpacing: 1.2));
}

// ── Stats row ─────────────────────────────────────────────────────────────────

class _StatsRow extends StatelessWidget {
  final List<UserFollow> follows;
  const _StatsRow({required this.follows});

  @override
  Widget build(BuildContext context) {
    final closed   = follows.where((f) => f.outcome == 'WIN' || f.outcome == 'LOSS').toList();
    final wins     = closed.where((f) => f.outcome == 'WIN').length;
    final winRate  = closed.isEmpty ? 0 : (wins * 100 ~/ closed.length);
    final withPct  = closed.where((f) => f.profitPct != null).toList();
    final avgPnl   = withPct.isEmpty
        ? null
        : withPct.map((f) => f.profitPct!).reduce((a, b) => a + b) / withPct.length;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Row(children: [
        _StatChip(
          label: 'Win Rate',
          value: '$winRate%',
          color: winRate >= 50 ? AppColors.buy : AppColors.sell,
        ),
        const SizedBox(width: 8),
        _StatChip(
          label: 'Closed',
          value: '${closed.length}',
          color: AppColors.primary,
        ),
        if (avgPnl != null) ...[
          const SizedBox(width: 8),
          _StatChip(
            label: 'Avg P&L',
            value: '${avgPnl >= 0 ? '+' : ''}${avgPnl.toStringAsFixed(1)}%',
            color: avgPnl >= 0 ? AppColors.buy : AppColors.sell,
          ),
        ],
      ]),
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _StatChip({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: color.withValues(alpha: 0.25)),
    ),
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      Text(value,
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: color)),
      Text(label,
          style: const TextStyle(fontSize: 9, color: AppColors.textMuted)),
    ]),
  );
}
