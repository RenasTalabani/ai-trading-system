import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/advisor_provider.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';

class AdvisorScreen extends ConsumerWidget {
  const AdvisorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final form        = ref.watch(advisorFormProvider);
    final state       = ref.watch(advisorProvider);
    final brainAsync  = ref.watch(brainActionProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            floating: true,
            snap: true,
            backgroundColor: AppColors.background,
            title: const Text('Deep Advisor',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
          ),

          // ── Brain context banner ──────────────────────────────────────────
          SliverToBoxAdapter(
            child: brainAsync.whenOrNull(
              data: (r) => _BrainBanner(report: r, form: form),
            ) ?? const SizedBox.shrink(),
          ),

          // ── Asset selector ────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _Label('SELECT ASSET'),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 38,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: kAdvisorAssets.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (_, i) {
                        final a        = kAdvisorAssets[i];
                        final selected = form.asset == a;
                        final base     = a.replaceAll('USDT', '');
                        return GestureDetector(
                          onTap: () => ref.read(advisorFormProvider.notifier)
                              .update((s) => s.copyWith(asset: a)),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 150),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 8),
                            decoration: BoxDecoration(
                              color: selected
                                  ? AppColors.primary.withValues(alpha: 0.2)
                                  : AppColors.card,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                  color: selected
                                      ? AppColors.primary
                                      : AppColors.border),
                            ),
                            child: Text(base,
                                style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: selected
                                        ? FontWeight.w700
                                        : FontWeight.normal,
                                    color: selected
                                        ? AppColors.primary
                                        : AppColors.textSecondary)),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),

          // ── Timeframe selector ────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _Label('TIMEFRAMES'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: kAdvisorTimeframes.map((tf) {
                      final selected = form.timeframes.contains(tf);
                      return GestureDetector(
                        onTap: () {
                          final tfs = List<String>.from(form.timeframes);
                          selected ? tfs.remove(tf) : tfs.add(tf);
                          if (tfs.isNotEmpty) {
                            ref.read(advisorFormProvider.notifier)
                                .update((s) => s.copyWith(timeframes: tfs));
                          }
                        },
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 150),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(
                            color: selected
                                ? AppColors.primary.withValues(alpha: 0.15)
                                : AppColors.card,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                                color: selected
                                    ? AppColors.primary
                                    : AppColors.border),
                          ),
                          child: Text(tf,
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: selected
                                      ? FontWeight.w700
                                      : FontWeight.normal,
                                  color: selected
                                      ? AppColors.primary
                                      : AppColors.textSecondary)),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ),
            ),
          ),

          // ── Analyze button ────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                  onPressed: state.loading
                      ? null
                      : () => ref.read(advisorProvider.notifier)
                          .analyze(form.asset, form.timeframes),
                  icon: state.loading
                      ? const SizedBox(
                          width: 16, height: 16,
                          child: CircularProgressIndicator(
                              color: Colors.white, strokeWidth: 2))
                      : const Icon(Icons.psychology, size: 18),
                  label: Text(
                    state.loading
                        ? 'Analyzing ${form.asset.replaceAll('USDT', '')}...'
                        : 'Analyze ${form.asset.replaceAll('USDT', '')}',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ),
          ),

          // ── Error ─────────────────────────────────────────────────────────
          if (state.error != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.card,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                        color: AppColors.sell.withValues(alpha: 0.4)),
                  ),
                  child: Row(children: [
                    const Icon(Icons.error_outline,
                        color: AppColors.sell, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(state.error!,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13)),
                    ),
                  ]),
                ),
              ),
            ),

          // ── Results ───────────────────────────────────────────────────────
          if (state.result != null) ...[
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                child: _SummaryCard(result: state.result!),
              ),
            ),
            SliverList(
              delegate: SliverChildBuilderDelegate(
                (_, i) => Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                  child: _TimeframeCard(rec: state.result!.timeframes[i]),
                ),
                childCount: state.result!.timeframes.length,
              ),
            ),
          ],

          const SliverPadding(padding: EdgeInsets.only(bottom: 32)),
        ],
      ),
    );
  }
}

// ── Brain context banner ──────────────────────────────────────────────────────

class _BrainBanner extends ConsumerWidget {
  final ActionReport report;
  final AdvisorFormState form;
  const _BrainBanner({required this.report, required this.form});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isSameAsset = report.bestAsset.toUpperCase().contains(
        form.asset.replaceAll('USDT', '').toUpperCase());
    final c = report.action == 'BUY'
        ? AppColors.buy
        : report.action == 'SELL'
            ? AppColors.sell
            : AppColors.hold;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: GestureDetector(
        onTap: () => ref.read(advisorFormProvider.notifier).update(
            (s) => s.copyWith(asset: '${report.bestAsset}USDT')),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
          decoration: BoxDecoration(
            color: c.withValues(alpha: 0.07),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: c.withValues(alpha: 0.3)),
          ),
          child: Row(children: [
            Container(
              width: 6, height: 6,
              decoration: BoxDecoration(color: c, shape: BoxShape.circle),
            ),
            const SizedBox(width: 10),
            Expanded(child: RichText(text: TextSpan(
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
              children: [
                const TextSpan(text: 'AI Brain top pick: '),
                TextSpan(text: report.displayName,
                    style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700)),
                TextSpan(text: ' ${report.action}',
                    style: TextStyle(color: c, fontWeight: FontWeight.w800)),
                TextSpan(text: ' · ${report.confidence}% conf'),
              ],
            ))),
            if (!isSameAsset)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text('Analyze this',
                    style: TextStyle(fontSize: 10, color: AppColors.primary,
                        fontWeight: FontWeight.w600)),
              ),
          ]),
        ),
      ),
    );
  }
}

// ── Summary card ──────────────────────────────────────────────────────────────

class _SummaryCard extends StatelessWidget {
  final AdvisorResult result;
  const _SummaryCard({required this.result});

  @override
  Widget build(BuildContext context) {
    final c = _actionColor(result.overallAction);
    final moodColor = result.trendAlignment == 'bullish'
        ? AppColors.buy
        : result.trendAlignment == 'bearish'
            ? AppColors.sell
            : AppColors.hold;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: c.withValues(alpha: 0.4), width: 1.5),
        gradient: LinearGradient(
          begin: Alignment.topLeft, end: Alignment.bottomRight,
          colors: [c.withValues(alpha: 0.07), AppColors.card],
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(result.asset.replaceAll('USDT', ''),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900,
                  color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          const Text('Overall Signal',
              style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
                color: c, borderRadius: BorderRadius.circular(10)),
            child: Text(result.overallAction,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900,
                    color: Colors.white, letterSpacing: 1)),
          ),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          Text('${result.overallConfidence.toStringAsFixed(0)}%',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900,
                  color: c)),
          const SizedBox(width: 8),
          const Text('confidence',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
          const Spacer(),
          _Pill(label: result.trendAlignment.toUpperCase(), color: moodColor),
        ]),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: result.overallConfidence / 100,
            minHeight: 6,
            backgroundColor: AppColors.border,
            valueColor: AlwaysStoppedAnimation(c),
          ),
        ),
        const SizedBox(height: 12),
        Row(children: [
          const Icon(Icons.check_circle_outline, size: 13,
              color: AppColors.textMuted),
          const SizedBox(width: 6),
          Text('${result.alignmentPct}% of timeframes agree',
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          const Spacer(),
          const Text('Best: ',
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          Text(result.bestTimeframe,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                  color: AppColors.primary)),
        ]),
      ]),
    );
  }
}

// ── Timeframe card ────────────────────────────────────────────────────────────

class _TimeframeCard extends StatefulWidget {
  final TimeframeRec rec;
  const _TimeframeCard({required this.rec});

  @override
  State<_TimeframeCard> createState() => _TimeframeCardState();
}

class _TimeframeCardState extends State<_TimeframeCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final c = _actionColor(widget.rec.action);
    final riskColor = widget.rec.riskLevel == 'low'
        ? AppColors.buy
        : widget.rec.riskLevel == 'medium'
            ? AppColors.hold
            : AppColors.sell;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [

        // ── Header row ──────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Row(children: [
            Text(widget.rec.label,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            _Pill(label: widget.rec.action, color: c),
            const SizedBox(width: 6),
            _Pill(label: widget.rec.riskLevel, color: riskColor),
          ]),
        ),

        // ── Stats row ────────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${widget.rec.confidence.toStringAsFixed(0)}%',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900,
                      color: c)),
              const Text('confidence',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ]),
            const SizedBox(width: 24),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.rec.expectedReturn,
                  style: TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w800,
                      color: widget.rec.expectedReturn.startsWith('+')
                          ? AppColors.buy
                          : AppColors.sell)),
              const Text('expected',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ]),
            const Spacer(),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              if (widget.rec.takeProfit > 0)
                Text('TP ${_fmt(widget.rec.takeProfit)}',
                    style: const TextStyle(fontSize: 11,
                        color: AppColors.buy, fontWeight: FontWeight.w600)),
              if (widget.rec.stopLoss > 0)
                Text('SL ${_fmt(widget.rec.stopLoss)}',
                    style: const TextStyle(fontSize: 11,
                        color: AppColors.sell, fontWeight: FontWeight.w600)),
            ]),
          ]),
        ),

        // ── Confidence bar ────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: widget.rec.confidence / 100,
              minHeight: 4,
              backgroundColor: AppColors.border,
              valueColor: AlwaysStoppedAnimation(c),
            ),
          ),
        ),

        // ── Reason + indicators (expandable) ─────────────────────────────
        if (widget.rec.reason.isNotEmpty || widget.rec.indicators.isNotEmpty) ...[
          GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (widget.rec.reason.isNotEmpty)
                    Text(widget.rec.reason,
                        maxLines: _expanded ? 20 : 2,
                        overflow: _expanded
                            ? TextOverflow.visible
                            : TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12,
                            color: AppColors.textSecondary, height: 1.5)),
                  if (widget.rec.reason.length > 80) ...[
                    const SizedBox(height: 4),
                    Text(_expanded ? 'Show less' : 'Show more',
                        style: const TextStyle(fontSize: 11,
                            color: AppColors.primary,
                            fontWeight: FontWeight.w600)),
                  ],
                  if (_expanded && widget.rec.indicators.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(spacing: 8, runSpacing: 4, children: [
                      if (widget.rec.indicators['rsi'] != null)
                        _IndChip(label: 'RSI',
                            value: widget.rec.indicators['rsi']
                                .toStringAsFixed(0)),
                      if (widget.rec.indicators['ema20'] != null)
                        _IndChip(label: 'EMA20',
                            value: _fmt(widget.rec.indicators['ema20'])),
                      if (widget.rec.indicators['ema50'] != null)
                        _IndChip(label: 'EMA50',
                            value: _fmt(widget.rec.indicators['ema50'])),
                    ]),
                  ],
                ],
              ),
            ),
          ),
        ] else
          const SizedBox(height: 14),
      ]),
    );
  }

  String _fmt(dynamic v) {
    final d = (v as num).toDouble();
    if (d > 1000) return d.toStringAsFixed(0);
    if (d > 1)    return d.toStringAsFixed(4);
    return d.toStringAsFixed(6);
  }
}

// ── Small widgets ─────────────────────────────────────────────────────────────

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);

  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
          color: AppColors.textMuted, letterSpacing: 1.2));
}

class _Pill extends StatelessWidget {
  final String label;
  final Color  color;
  const _Pill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(label,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
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
        color: AppColors.background, borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.border)),
    child: Text('$label: $value',
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
  );
}

Color _actionColor(String action) {
  if (action == 'BUY')  return AppColors.buy;
  if (action == 'SELL') return AppColors.sell;
  return AppColors.hold;
}
