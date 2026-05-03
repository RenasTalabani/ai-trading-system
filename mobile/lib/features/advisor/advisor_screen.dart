import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/advisor_provider.dart';
import '../../core/theme/app_theme.dart';

class AdvisorScreen extends ConsumerStatefulWidget {
  const AdvisorScreen({super.key});
  @override
  ConsumerState<AdvisorScreen> createState() => _AdvisorScreenState();
}

class _AdvisorScreenState extends ConsumerState<AdvisorScreen> {
  @override
  Widget build(BuildContext context) {
    final form  = ref.watch(advisorFormProvider);
    final state = ref.watch(advisorProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('AI Advisor')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _FormCard(form: form),
          const SizedBox(height: 12),
          if (state.loading) const Center(child: CircularProgressIndicator(color: AppColors.primary)),
          if (state.error != null) _ErrorCard(message: state.error!),
          if (state.result != null) ...[
            _SummaryCard(result: state.result!),
            const SizedBox(height: 12),
            ...state.result!.timeframes.map((tf) => _TimeframeCard(rec: tf)),
          ],
        ],
      ),
    );
  }
}

// ── Form ──────────────────────────────────────────────────────────────────────

class _FormCard extends ConsumerWidget {
  final AdvisorFormState form;
  const _FormCard({required this.form});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Select Asset', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            SizedBox(
              height: 36,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: kAdvisorAssets.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final a = kAdvisorAssets[i];
                  final selected = form.asset == a;
                  return ChoiceChip(
                    label: Text(a.replaceAll('USDT', ''), style: const TextStyle(fontSize: 12)),
                    selected: selected,
                    onSelected: (_) => ref.read(advisorFormProvider.notifier)
                        .update((s) => s.copyWith(asset: a)),
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
            Text('Timeframes', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: kAdvisorTimeframes.map((tf) {
                final selected = form.timeframes.contains(tf);
                return FilterChip(
                  label: Text(tf, style: const TextStyle(fontSize: 12)),
                  selected: selected,
                  onSelected: (on) {
                    final tfs = List<String>.from(form.timeframes);
                    on ? tfs.add(tf) : tfs.remove(tf);
                    if (tfs.isNotEmpty) {
                      ref.read(advisorFormProvider.notifier)
                          .update((s) => s.copyWith(timeframes: tfs));
                    }
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () => ref.read(advisorProvider.notifier).analyze(
                    form.asset, form.timeframes),
              icon: const Icon(Icons.psychology),
              label: const Text('Analyze'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

class _SummaryCard extends StatelessWidget {
  final AdvisorResult result;
  const _SummaryCard({required this.result});

  @override
  Widget build(BuildContext context) {
    final color = _actionColor(result.overallAction);
    final moodColor = result.trendAlignment == 'bullish'
        ? AppColors.buy
        : result.trendAlignment == 'bearish'
            ? AppColors.sell
            : AppColors.hold;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.bar_chart, color: AppColors.primary, size: 18),
              const SizedBox(width: 8),
              Text('${result.asset} — Overall Signal',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: color.withValues(alpha: 0.4)),
                ),
                child: Text(result.overallAction,
                    style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 20)),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${result.overallConfidence.toStringAsFixed(0)}% confidence',
                      style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  LinearProgressIndicator(
                    value: result.overallConfidence / 100,
                    color: color,
                    backgroundColor: AppColors.surface,
                    minHeight: 6,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ]),
              ),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              _Pill(label: result.trendAlignment.toUpperCase(), color: moodColor),
              const SizedBox(width: 8),
              Text('${result.alignmentPct}% of timeframes agree',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              const Spacer(),
              Text('Best: ${result.bestTimeframe}',
                  style: const TextStyle(color: AppColors.primary, fontSize: 12, fontWeight: FontWeight.w600)),
            ]),
          ],
        ),
      ),
    );
  }
}

// ── Timeframe card ────────────────────────────────────────────────────────────

class _TimeframeCard extends StatelessWidget {
  final TimeframeRec rec;
  const _TimeframeCard({required this.rec});

  @override
  Widget build(BuildContext context) {
    final color    = _actionColor(rec.action);
    final riskColor = rec.riskLevel == 'low'
        ? AppColors.buy
        : rec.riskLevel == 'medium'
            ? AppColors.hold
            : AppColors.sell;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Text(rec.label,
                  style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 14)),
              const Spacer(),
              _Pill(label: rec.action, color: color),
              const SizedBox(width: 6),
              _Pill(label: rec.riskLevel, color: riskColor),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${rec.confidence.toStringAsFixed(0)}%',
                      style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 22)),
                  const Text('confidence', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                ]),
              ),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.center, children: [
                  Text(rec.expectedReturn,
                      style: TextStyle(
                          color: rec.expectedReturn.startsWith('+') ? AppColors.buy : AppColors.sell,
                          fontWeight: FontWeight.bold, fontSize: 18)),
                  const Text('expected return', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                ]),
              ),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  if (rec.takeProfit > 0)
                    Text('TP ${_fmt(rec.takeProfit)}',
                        style: const TextStyle(color: AppColors.buy, fontSize: 12)),
                  if (rec.stopLoss > 0)
                    Text('SL ${_fmt(rec.stopLoss)}',
                        style: const TextStyle(color: AppColors.sell, fontSize: 12)),
                ]),
              ),
            ]),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: rec.confidence / 100,
              color: color,
              backgroundColor: AppColors.surface,
              minHeight: 4,
              borderRadius: BorderRadius.circular(4),
            ),
            if (rec.reason.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(rec.reason,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
            if (rec.indicators.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 4, children: [
                if (rec.indicators['rsi'] != null)
                  _IndChip(label: 'RSI', value: rec.indicators['rsi'].toStringAsFixed(0)),
                if (rec.indicators['ema20'] != null)
                  _IndChip(label: 'EMA20', value: _fmt(rec.indicators['ema20'])),
                if (rec.indicators['ema50'] != null)
                  _IndChip(label: 'EMA50', value: _fmt(rec.indicators['ema50'])),
              ]),
            ],
          ],
        ),
      ),
    );
  }

  String _fmt(dynamic v) {
    final d = (v as num).toDouble();
    if (d > 1000) return d.toStringAsFixed(0);
    if (d > 1) return d.toStringAsFixed(4);
    return d.toStringAsFixed(6);
  }
}

// ── Widgets ───────────────────────────────────────────────────────────────────

class _Pill extends StatelessWidget {
  final String label;
  final Color color;
  const _Pill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(label,
            style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
      );
}

class _IndChip extends StatelessWidget {
  final String label;
  final String value;
  const _IndChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
            color: AppColors.surface, borderRadius: BorderRadius.circular(6)),
        child: Text('$label: $value',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
      );
}

class _ErrorCard extends StatelessWidget {
  final String message;
  const _ErrorCard({required this.message});

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            const Icon(Icons.error_outline, color: AppColors.error),
            const SizedBox(width: 12),
            Expanded(child: Text(message,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
          ]),
        ),
      );
}

Color _actionColor(String action) {
  if (action == 'BUY')  return AppColors.buy;
  if (action == 'SELL') return AppColors.sell;
  return AppColors.hold;
}
