import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/providers/core_provider.dart';
import '../../core/theme/app_theme.dart';

final _capitalProvider = StateProvider<double>((ref) => 500.0);

class FollowedAIScreen extends ConsumerWidget {
  const FollowedAIScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final capital   = ref.watch(_capitalProvider);
    final simAsync  = ref.watch(coreSimProvider(capital));
    final histAsync = ref.watch(coreDecisionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('If You Followed AI'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(coreSimProvider(capital));
              ref.invalidate(coreDecisionsProvider);
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async {
          ref.invalidate(coreSimProvider(capital));
          ref.invalidate(coreDecisionsProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            _CapitalSelector(capital: capital),
            const SizedBox(height: 16),
            simAsync.when(
              loading: () => const _LoadingCard(),
              error:   (e, _) => _ErrorCard(
                message: e.toString(),
                onRetry: () => ref.invalidate(coreSimProvider(capital)),
              ),
              data:    (result) => _ResultView(result: result),
            ),
            const SizedBox(height: 24),
            histAsync.when(
              loading: () => const _LoadingCard(),
              error:   (e, _) => const SizedBox.shrink(),
              data:    (data) => _DecisionHistory(data: data),
            ),
            const SizedBox(height: 24),
          ]),
        ),
      ),
    );
  }
}

// ── Capital selector ──────────────────────────────────────────────────────────

class _CapitalSelector extends ConsumerWidget {
  final double capital;
  const _CapitalSelector({required this.capital});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
          const Text('Starting Capital',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [100, 500, 1000, 5000].map((v) {
              final selected = capital == v.toDouble();
              return GestureDetector(
                onTap: () => ref.read(_capitalProvider.notifier).state = v.toDouble(),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.primary.withValues(alpha: 0.2)
                        : AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: selected ? AppColors.primary : AppColors.border),
                  ),
                  child: Text('\$$v',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
                        color: selected ? AppColors.primary : AppColors.textSecondary,
                      )),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

// ── Result view ───────────────────────────────────────────────────────────────

class _ResultView extends StatelessWidget {
  final CoreSimResult result;
  const _ResultView({required this.result});

  @override
  Widget build(BuildContext context) {
    if (result.message != null && result.totalTrades == 0) {
      return _EmptyCard(message: result.message!);
    }

    final profitPositive = result.profit >= 0;
    final profitColor    = profitPositive ? AppColors.buy : AppColors.sell;

    return Column(children: [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: profitColor.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: profitColor.withValues(alpha: 0.4), width: 1.5),
        ),
        child: Column(children: [
          const Text('Your Balance Would Be',
              style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Text('\$${result.balance.toStringAsFixed(2)}',
              style: TextStyle(
                  fontSize: 36, fontWeight: FontWeight.w900, color: profitColor)),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: profitColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '${profitPositive ? '+' : ''}\$${result.profit.toStringAsFixed(2)} '
              '(${profitPositive ? '+' : ''}${result.profitPercent.toStringAsFixed(1)}%)',
              style: TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w700, color: profitColor),
            ),
          ),
          const SizedBox(height: 4),
          Text('starting from \$${result.capital.toStringAsFixed(0)}',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ]),
      ),

      const SizedBox(height: 12),

      Row(children: [
        _StatBox(
          label: 'Win Rate',
          value: '${result.winRate}%',
          color: result.winRate >= 50 ? AppColors.buy : AppColors.sell,
        ),
        const SizedBox(width: 8),
        _StatBox(
          label: 'Total Trades',
          value: '${result.totalTrades}',
          color: AppColors.primary,
        ),
        const SizedBox(width: 8),
        _StatBox(
          label: 'Wins / Losses',
          value: '${result.wins} / ${result.losses}',
          color: AppColors.textPrimary,
        ),
      ]),

      if (result.equityCurve.length > 1) ...[
        const SizedBox(height: 12),
        _EquityCurveChart(curve: result.equityCurve, capital: result.capital),
      ],
    ]);
  }
}

class _StatBox extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _StatBox({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Column(children: [
          Text(value,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
          const SizedBox(height: 3),
          Text(label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
        ]),
      ),
    );
  }
}

// ── Equity curve chart ────────────────────────────────────────────────────────

class _EquityCurveChart extends StatelessWidget {
  final List<EquityPoint> curve;
  final double            capital;
  const _EquityCurveChart({required this.curve, required this.capital});

  @override
  Widget build(BuildContext context) {
    final profitColor = curve.last.balance >= capital ? AppColors.buy : AppColors.sell;

    final spots = curve.asMap().entries.map((e) =>
        FlSpot(e.key.toDouble(), e.value.balance)).toList();

    final minY = curve.map((p) => p.balance).reduce((a, b) => a < b ? a : b);
    final maxY = curve.map((p) => p.balance).reduce((a, b) => a > b ? a : b);
    final padding = (maxY - minY) * 0.12 + 1;

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
          Row(children: [
            const Icon(Icons.show_chart, size: 14, color: AppColors.primary),
            const SizedBox(width: 6),
            const Text('Equity Curve',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            Text('${curve.length - 1} trades',
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ]),
          const SizedBox(height: 16),
          SizedBox(
            height: 140,
            child: LineChart(
              LineChartData(
                minY: minY - padding,
                maxY: maxY + padding,
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: (maxY - minY + padding * 2) / 4,
                  getDrawingHorizontalLine: (_) => const FlLine(
                    color: AppColors.border,
                    strokeWidth: 0.5,
                  ),
                ),
                borderData: FlBorderData(show: false),
                titlesData: FlTitlesData(
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 50,
                      getTitlesWidget: (v, _) => Text(
                        '\$${v.toStringAsFixed(0)}',
                        style: const TextStyle(fontSize: 9, color: AppColors.textMuted),
                      ),
                    ),
                  ),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles:   const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                lineBarsData: [
                  // Capital baseline
                  LineChartBarData(
                    spots: [FlSpot(0, capital), FlSpot((curve.length - 1).toDouble(), capital)],
                    isCurved: false,
                    color: AppColors.border,
                    barWidth: 1,
                    dotData: const FlDotData(show: false),
                    dashArray: [4, 4],
                  ),
                  // Equity line
                  LineChartBarData(
                    spots: spots,
                    isCurved: true,
                    curveSmoothness: 0.3,
                    color: profitColor,
                    barWidth: 2,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(
                      show: true,
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          profitColor.withValues(alpha: 0.25),
                          profitColor.withValues(alpha: 0.0),
                        ],
                      ),
                    ),
                  ),
                ],
                lineTouchData: LineTouchData(
                  touchTooltipData: LineTouchTooltipData(
                    getTooltipColor: (_) => AppColors.surface,
                    getTooltipItems: (spots) => spots.map((s) {
                      if (s.barIndex == 0) return null;
                      return LineTooltipItem(
                        '\$${s.y.toStringAsFixed(2)}',
                        TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: profitColor,
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Decision history ──────────────────────────────────────────────────────────

class _DecisionHistory extends StatelessWidget {
  final CoreDecisionsData data;
  const _DecisionHistory({required this.data});

  @override
  Widget build(BuildContext context) {
    if (data.decisions.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Decision History',
            style: TextStyle(
                fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        const SizedBox(height: 10),
        ...data.decisions.map((d) => _DecisionTile(record: d)),
      ],
    );
  }
}

class _DecisionTile extends StatelessWidget {
  final DecisionRecord record;
  const _DecisionTile({required this.record});

  Color get _resultColor {
    switch (record.result) {
      case 'WIN':  return AppColors.buy;
      case 'LOSS': return AppColors.sell;
      default:     return AppColors.primary;
    }
  }

  Color get _decisionColor {
    switch (record.decision.toUpperCase()) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasProfit = record.profitPct != null;
    final pct       = record.profitPct ?? 0.0;
    final pctColor  = pct >= 0 ? AppColors.buy : AppColors.sell;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: [
        // Result badge
        Container(
          width: 52,
          padding: const EdgeInsets.symmetric(vertical: 5),
          decoration: BoxDecoration(
            color: _resultColor.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(record.result,
              textAlign: TextAlign.center,
              style: TextStyle(
                  fontSize: 10, fontWeight: FontWeight.w800, color: _resultColor)),
        ),

        const SizedBox(width: 10),

        // Asset + decision + confidence
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Text(record.displayName,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: _decisionColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(record.decision,
                      style: TextStyle(
                          fontSize: 9, fontWeight: FontWeight.w800,
                          color: _decisionColor)),
                ),
              ]),
              const SizedBox(height: 2),
              Text('${record.confidence}% confidence · ${record.timeframe}',
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ],
          ),
        ),

        // Profit pct or OPEN
        if (hasProfit && record.result != 'OPEN')
          Text('${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(1)}%',
              style: TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w700, color: pctColor))
        else if (record.result == 'OPEN')
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text('LIVE',
                style: TextStyle(
                    fontSize: 9, fontWeight: FontWeight.w800,
                    color: AppColors.primary)),
          ),
      ]),
    );
  }
}

// ── Helper widgets ────────────────────────────────────────────────────────────

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();
  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 120,
    child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
  );
}

class _EmptyCard extends StatelessWidget {
  final String message;
  const _EmptyCard({required this.message});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(children: [
      const Icon(Icons.hourglass_top, size: 40, color: AppColors.textMuted),
      const SizedBox(height: 12),
      Text(message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary)),
    ]),
  );
}

class _ErrorCard extends StatelessWidget {
  final String       message;
  final VoidCallback onRetry;
  const _ErrorCard({required this.message, required this.onRetry});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.sell.withValues(alpha: 0.3)),
    ),
    child: Column(children: [
      const Icon(Icons.error_outline, size: 36, color: AppColors.sell),
      const SizedBox(height: 10),
      Text(message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary)),
      const SizedBox(height: 14),
      TextButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
        label: const Text('Retry'),
      ),
    ]),
  );
}
