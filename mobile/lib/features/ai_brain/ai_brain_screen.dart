import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/core_provider.dart';
import '../../core/theme/app_theme.dart';

class AIBrainScreen extends ConsumerStatefulWidget {
  const AIBrainScreen({super.key});

  @override
  ConsumerState<AIBrainScreen> createState() => _AIBrainScreenState();
}

class _AIBrainScreenState extends ConsumerState<AIBrainScreen> {
  Timer? _autoRefresh;

  @override
  void initState() {
    super.initState();
    // Auto-refresh every 5 minutes to stay in sync with the 15-min decision cycle
    _autoRefresh = Timer.periodic(const Duration(minutes: 5), (_) {
      if (mounted) ref.invalidate(coreAdviceProvider);
    });
  }

  @override
  void dispose() {
    _autoRefresh?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(coreAdviceProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Brain'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.refresh(coreAdviceProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(color: AppColors.primary),
            SizedBox(height: 16),
            Text('AI is scanning markets…',
                style: TextStyle(color: AppColors.textSecondary)),
          ]),
        ),
        error: (e, _) => _ErrorView(
          message: e.toString(),
          onRetry: () => ref.refresh(coreAdviceProvider),
        ),
        data: (advice) => RefreshIndicator(
          onRefresh: () => ref.refresh(coreAdviceProvider.future),
          color: AppColors.primary,
          backgroundColor: AppColors.card,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              _DecisionCard(advice: advice),
              const SizedBox(height: 16),
              _DetailsCard(advice: advice),
              const SizedBox(height: 16),
              _ReasonCard(advice: advice),
              if (advice.topPicks.isNotEmpty) ...[
                const SizedBox(height: 16),
                _TopPicksCard(picks: advice.topPicks),
              ],
              const SizedBox(height: 24),
            ]),
          ),
        ),
      ),
    );
  }
}

// ── Decision hero card ────────────────────────────────────────────────────────

class _DecisionCard extends StatelessWidget {
  final CoreAdvice advice;
  const _DecisionCard({required this.advice});

  Color get _color => advice.decision == 'BUY'
      ? AppColors.buy
      : advice.decision == 'SELL'
          ? AppColors.sell
          : AppColors.hold;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _color.withValues(alpha: 0.4), width: 1.5),
      ),
      child: Column(children: [
        // Asset name
        Text(advice.displayName,
            style: const TextStyle(
                fontSize: 18, fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
        const SizedBox(height: 4),
        Text(advice.asset,
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),

        const SizedBox(height: 20),

        // Big decision badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
          decoration: BoxDecoration(
            color: _color,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(advice.decision,
              style: const TextStyle(
                  fontSize: 28, fontWeight: FontWeight.w900,
                  color: Colors.white, letterSpacing: 2)),
        ),

        const SizedBox(height: 20),

        // Confidence bar
        Row(children: [
          Text('${advice.confidence}% confidence',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                  color: _color)),
          const Spacer(),
          Text(advice.timeframe,
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
        ]),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value:           advice.confidence / 100,
            minHeight:       8,
            backgroundColor: AppColors.border,
            valueColor:      AlwaysStoppedAnimation(_color),
          ),
        ),

        const SizedBox(height: 16),

        // Expected profit
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.trending_up, size: 16, color: AppColors.buy),
            const SizedBox(width: 6),
            Text('Expected: ${advice.expectedProfit}',
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w600,
                    color: AppColors.buy)),
          ]),
        ),

        if (advice.scannedAt != null) ...[
          const SizedBox(height: 10),
          Text(_timeAgo(advice.scannedAt!),
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ],
      ]),
    );
  }

  String _timeAgo(DateTime dt) {
    final d = DateTime.now().difference(dt);
    if (d.inMinutes < 1)  return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes}m ago';
    return '${d.inHours}h ago';
  }
}

// ── Trade levels card ─────────────────────────────────────────────────────────

class _DetailsCard extends StatelessWidget {
  final CoreAdvice advice;
  const _DetailsCard({required this.advice});

  String _fmt(double? v) {
    if (v == null) return '—';
    if (v >= 1000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 1)    return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Trade Levels',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 14),
          Row(children: [
            _Level(label: 'Entry',  value: _fmt(advice.currentPrice), color: AppColors.primary),
            _Level(label: 'Stop Loss', value: _fmt(advice.stopLoss),  color: AppColors.sell),
            _Level(label: 'Take Profit', value: _fmt(advice.takeProfit), color: AppColors.buy),
            if (advice.riskReward != null)
              _Level(label: 'Risk/Reward', value: advice.riskReward!, color: AppColors.textPrimary),
          ]),
        ],
      ),
    );
  }
}

class _Level extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _Level({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Column(children: [
      Text(value,
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color)),
      const SizedBox(height: 3),
      Text(label,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
    ]));
  }
}

// ── Reason card ───────────────────────────────────────────────────────────────

class _ReasonCard extends StatelessWidget {
  final CoreAdvice advice;
  const _ReasonCard({required this.advice});

  @override
  Widget build(BuildContext context) {
    if (advice.reason.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.lightbulb_outline, size: 14, color: AppColors.warning),
          SizedBox(width: 6),
          Text('Why this decision?',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
        ]),
        const SizedBox(height: 10),
        Text(advice.reason,
            style: const TextStyle(
                fontSize: 13, color: AppColors.textSecondary, height: 1.6)),
      ]),
    );
  }
}

// ── Top Opportunities card ────────────────────────────────────────────────────

class _TopPicksCard extends StatelessWidget {
  final List<TopPick> picks;
  const _TopPicksCard({required this.picks});

  Color _decisionColor(String d) {
    switch (d) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [
            Icon(Icons.leaderboard, size: 14, color: AppColors.primary),
            SizedBox(width: 6),
            Text('Top Opportunities',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
          ]),
          const SizedBox(height: 12),
          ...picks.map((p) {
            final color = _decisionColor(p.decision);
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Expanded(
                  child: Text(p.asset,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(p.decision,
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800,
                          color: color)),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 80,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('${p.confidence}%',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                              color: color)),
                      const SizedBox(height: 3),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(
                          value: p.confidence / 100,
                          minHeight: 4,
                          backgroundColor: AppColors.border,
                          valueColor: AlwaysStoppedAnimation(color),
                        ),
                      ),
                    ],
                  ),
                ),
              ]),
            );
          }),
        ],
      ),
    );
  }
}

// ── Error view ────────────────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  final String       message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.wifi_off, size: 48, color: AppColors.textMuted),
          const SizedBox(height: 16),
          Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 20),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ]),
      ),
    );
  }
}
