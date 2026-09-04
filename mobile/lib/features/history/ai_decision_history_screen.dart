import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/ai_decision_model.dart';
import '../../core/providers/ai_decision_history_provider.dart';
import '../../core/theme/app_theme.dart';

// Master-plan decision #21: "one main screen only, everything else in a
// secondary settings/history panel". This screen IS that history panel for
// the AI's decisions -- reached only from Settings, read-only, no approve/
// reject actions here (those live exclusively on the main screen's live
// pending-proposal card while a decision is still actionable).
class AIDecisionHistoryScreen extends ConsumerStatefulWidget {
  const AIDecisionHistoryScreen({super.key});

  @override
  ConsumerState<AIDecisionHistoryScreen> createState() => _AIDecisionHistoryScreenState();
}

class _AIDecisionHistoryScreenState extends ConsumerState<AIDecisionHistoryScreen> {
  String _filter = 'ALL'; // ALL / APPROVED / REJECTED / EXPIRED / PENDING_APPROVAL

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(aiDecisionHistoryProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        title: const Text('AI Decision History',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () => ref.read(aiDecisionHistoryProvider.notifier).fetch(),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator(color: AppColors.primary)),
          error: (err, _) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              const SizedBox(height: 80),
              Center(
                child: Column(children: [
                  const Icon(Icons.error_outline, size: 40, color: AppColors.error),
                  const SizedBox(height: 8),
                  Text('$err', style: const TextStyle(color: AppColors.textSecondary), textAlign: TextAlign.center),
                ]),
              ),
            ],
          ),
          data: (decisions) {
            final items = _filter == 'ALL'
                ? decisions
                : decisions.where((d) => d.status == _filter).toList();

            return CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverToBoxAdapter(
                  child: _FilterBar(
                    current: _filter,
                    counts: {
                      'ALL': decisions.length,
                      'APPROVED': decisions.where((d) => d.status == 'APPROVED').length,
                      'REJECTED': decisions.where((d) => d.status == 'REJECTED').length,
                      'EXPIRED': decisions.where((d) => d.status == 'EXPIRED').length,
                      'PENDING_APPROVAL': decisions.where((d) => d.status == 'PENDING_APPROVAL').length,
                    },
                    onChanged: (v) => setState(() => _filter = v),
                  ),
                ),
                if (items.isEmpty)
                  SliverFillRemaining(
                    child: Center(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        const Icon(Icons.history_outlined, size: 52, color: AppColors.textMuted),
                        const SizedBox(height: 12),
                        Text(
                          _filter == 'ALL' ? 'No decisions yet' : 'No $_filter decisions',
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.textSecondary),
                        ),
                      ]),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (_, i) => _DecisionTile(decision: items[i]),
                        childCount: items.length,
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  final String current;
  final Map<String, int> counts;
  final void Function(String) onChanged;
  const _FilterBar({required this.current, required this.counts, required this.onChanged});

  static const _labels = {
    'ALL': 'All',
    'APPROVED': 'Approved',
    'REJECTED': 'Rejected',
    'EXPIRED': 'Expired',
    'PENDING_APPROVAL': 'Pending',
  };

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 44,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      children: _labels.entries.map((e) {
        final sel = e.key == current;
        return GestureDetector(
          onTap: () => onChanged(e.key),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            margin: const EdgeInsets.only(right: 8),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: sel ? AppColors.primary.withValues(alpha: 0.15) : AppColors.card,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: sel ? AppColors.primary : AppColors.border),
            ),
            child: Center(
              child: Text('${_labels[e.key]}  ${e.value}',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: sel ? FontWeight.w700 : FontWeight.normal,
                      color: sel ? AppColors.primary : AppColors.textSecondary)),
            ),
          ),
        );
      }).toList(),
    ),
  );
}

class _DecisionTile extends StatelessWidget {
  final AIDecisionModel decision;
  const _DecisionTile({required this.decision});

  Color get _statusColor {
    switch (decision.status) {
      case 'APPROVED': return AppColors.buy;
      case 'REJECTED': return AppColors.sell;
      case 'EXPIRED':  return AppColors.textMuted;
      default:          return AppColors.hold; // PENDING_APPROVAL
    }
  }

  Color get _actionColor =>
      decision.action == 'BUY' ? AppColors.buy
      : decision.action == 'SELL' ? AppColors.sell : AppColors.hold;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _statusColor.withValues(alpha: 0.3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(decision.displayName,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          _Badge(decision.action, _actionColor),
          const SizedBox(width: 6),
          _Badge(decision.status.replaceAll('_', ' '), _statusColor),
          const Spacer(),
          Text('${decision.confidence.toStringAsFixed(0)}%',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
        ]),
        if (decision.reason != null && decision.reason!.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(decision.reason!,
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.3),
              maxLines: 2, overflow: TextOverflow.ellipsis),
        ],
        if (decision.status == 'REJECTED' && decision.safetyGateReasons.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text('Blocked by safety gate: ${decision.safetyGateReasons.join(', ')}',
              style: const TextStyle(fontSize: 11, color: AppColors.error, height: 1.3)),
        ],
        const SizedBox(height: 8),
        Row(children: [
          if (decision.entryPrice != null)
            Text('Entry ${_fmt(decision.entryPrice!)}',
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          if (decision.profitPct != null) ...[
            const SizedBox(width: 10),
            Text('${decision.profitPct! >= 0 ? '+' : ''}${decision.profitPct!.toStringAsFixed(1)}%',
                style: TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w700,
                    color: decision.profitPct! >= 0 ? AppColors.buy : AppColors.sell)),
          ],
          const Spacer(),
          Text(_date(decision.createdAt), style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ]),
      ]),
    );
  }

  String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }

  String _date(DateTime dt) => '${dt.day}/${dt.month}/${dt.year}';
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  const _Badge(this.label, this.color);

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(4),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(label, style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: color)),
  );
}
