import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/models/dca_model.dart';
import '../../core/providers/dca_provider.dart';
import '../../core/providers/watchlist_provider.dart';
import '../../core/theme/app_theme.dart';

class DCAScreen extends ConsumerWidget {
  const DCAScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(dcaProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('DCA Plans')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showNewPlanSheet(context),
        icon: const Icon(Icons.add),
        label: const Text('New Plan'),
        backgroundColor: AppColors.primary,
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () => ref.read(dcaProvider.notifier).refresh(),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Failed to load: $e',
              style: const TextStyle(color: AppColors.error))),
          data: (plans) {
            if (plans.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 100),
                Center(child: Column(children: [
                  Icon(Icons.savings_outlined, size: 48, color: AppColors.textSecondary),
                  SizedBox(height: 12),
                  Text('No DCA plans yet',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 16)),
                  SizedBox(height: 6),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 40),
                    child: Text(
                      'Automatically buy a fixed dollar amount on a schedule, '
                      'instead of timing entries — simulated, no real money.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textMuted, fontSize: 13),
                    ),
                  ),
                ])),
              ]);
            }
            return ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
              itemCount: plans.length,
              itemBuilder: (context, i) => _PlanCard(plan: plans[i]),
            );
          },
        ),
      ),
    );
  }

  void _showNewPlanSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _NewPlanSheet(),
    );
  }
}

class _PlanCard extends ConsumerStatefulWidget {
  final DCAPlanModel plan;
  const _PlanCard({required this.plan});

  @override
  ConsumerState<_PlanCard> createState() => _PlanCardState();
}

class _PlanCardState extends ConsumerState<_PlanCard> {
  bool _acting = false;
  String? _error;

  Future<void> _approve() async {
    setState(() { _acting = true; _error = null; });
    try {
      await ref.read(dcaProvider.notifier).approveDueBuy(widget.plan.id);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _skip() async {
    setState(() { _acting = true; _error = null; });
    try {
      await ref.read(dcaProvider.notifier).skipDueBuy(widget.plan.id);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final plan = widget.plan;
    final fmt = NumberFormat('#,##0.####');
    final positive = (plan.unrealizedPnl ?? 0) >= 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: plan.dueBuyPending ? AppColors.warning.withValues(alpha: 0.6) : AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(displayNameFor(plan.asset),
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: (plan.isActive ? AppColors.success : AppColors.textMuted).withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(plan.isActive ? 'ACTIVE' : 'STOPPED',
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold,
                    color: plan.isActive ? AppColors.success : AppColors.textMuted)),
          ),
          const Spacer(),
          if (plan.isActive)
            IconButton(
              icon: const Icon(Icons.stop_circle_outlined, size: 20, color: AppColors.error),
              tooltip: 'Stop plan',
              onPressed: () => ref.read(dcaProvider.notifier).stopPlan(plan.id),
            ),
        ]),
        const SizedBox(height: 8),
        Text('\$${plan.amountPerBuy.toStringAsFixed(0)} every ${plan.frequencyDays}d '
            '· ${plan.purchases.length} buy${plan.purchases.length == 1 ? '' : 's'}',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: _Stat(label: 'Invested', value: '\$${plan.totalInvested.toStringAsFixed(2)}')),
          Expanded(child: _Stat(label: 'Avg Cost', value: '\$${fmt.format(plan.avgCostBasis)}')),
          Expanded(child: _Stat(
              label: 'Unrealized P&L',
              value: plan.unrealizedPnl != null
                  ? '${positive ? '+' : ''}\$${plan.unrealizedPnl!.toStringAsFixed(2)}'
                  : '—',
              color: plan.unrealizedPnl != null ? (positive ? AppColors.success : AppColors.error) : null)),
        ]),

        // Safety fix (2026-09-04, decision #11): a due buy no longer executes
        // on its own -- it waits right here for an explicit approve/skip tap.
        if (plan.dueBuyPending) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Buy due — \$${plan.amountPerBuy.toStringAsFixed(0)} of ${displayNameFor(plan.asset)}',
                  style: const TextStyle(color: AppColors.warning, fontSize: 13, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              if (_error != null) ...[
                Text(_error!, style: const TextStyle(color: AppColors.error, fontSize: 12)),
                const SizedBox(height: 8),
              ],
              Row(children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _acting ? null : _approve,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                    child: _acting
                        ? const SizedBox(width: 16, height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Approve', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _acting ? null : _skip,
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppColors.border),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                    child: const Text('Skip', style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ),
              ]),
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
  final Color? color;
  const _Stat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
    const SizedBox(height: 2),
    Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold,
        color: color ?? AppColors.textPrimary)),
  ]);
}

class _NewPlanSheet extends ConsumerStatefulWidget {
  const _NewPlanSheet();

  @override
  ConsumerState<_NewPlanSheet> createState() => _NewPlanSheetState();
}

class _NewPlanSheetState extends ConsumerState<_NewPlanSheet> {
  static const _frequencies = [1, 3, 7, 14, 30];
  String _asset = 'BTCUSDT';
  double _amount = 50;
  int _frequency = 7;
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    setState(() { _submitting = true; _error = null; });
    try {
      await ref.read(dcaProvider.notifier).startPlan(
            asset: _asset, amountPerBuy: _amount, frequencyDays: _frequency,
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() { _submitting = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 20, right: 20, top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      decoration: const BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('New DCA Plan',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: AppColors.textPrimary)),
        const SizedBox(height: 4),
        const Text('Simulated — buys a fixed amount on a schedule, no real money.',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
        const SizedBox(height: 18),

        const Text('Asset', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: allSupportedAssets.map((a) {
          final selected = a == _asset;
          return ChoiceChip(
            label: Text(displayNameFor(a)),
            selected: selected,
            onSelected: (_) => setState(() => _asset = a),
            selectedColor: AppColors.primary.withValues(alpha: 0.2),
            labelStyle: TextStyle(color: selected ? AppColors.primary : AppColors.textSecondary),
          );
        }).toList()),

        const SizedBox(height: 16),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Amount per buy', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
          Text('\$${_amount.toStringAsFixed(0)}',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.primary)),
        ]),
        Slider(
          value: _amount, min: 10, max: 500, divisions: 49,
          activeColor: AppColors.primary,
          onChanged: (v) => setState(() => _amount = v),
        ),

        const SizedBox(height: 8),
        const Text('Frequency', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: _frequencies.map((f) {
          final selected = f == _frequency;
          return ChoiceChip(
            label: Text(f == 1 ? 'Daily' : f == 7 ? 'Weekly' : f == 30 ? 'Monthly' : '${f}d'),
            selected: selected,
            onSelected: (_) => setState(() => _frequency = f),
            selectedColor: AppColors.primary.withValues(alpha: 0.2),
            labelStyle: TextStyle(color: selected ? AppColors.primary : AppColors.textSecondary),
          );
        }).toList()),

        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: AppColors.error, fontSize: 12)),
        ],

        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: _submitting ? null : _submit,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            child: _submitting
                ? const SizedBox(width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Start Plan', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ),
      ]),
    );
  }
}
