import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';

class VirtualPerformanceScreen extends ConsumerWidget {
  const VirtualPerformanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balance   = ref.watch(brainBalanceProvider);
    final perfAsync = ref.watch(brainPerformanceProvider(balance));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async {
          ref.invalidate(brainPerformanceProvider(balance));
        },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverAppBar(
              floating: true,
              snap: true,
              backgroundColor: AppColors.background,
              title: const Text('Portfolio',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              actions: [
                IconButton(
                  icon: const Icon(Icons.refresh, size: 20,
                      color: AppColors.textSecondary),
                  onPressed: () => ref.invalidate(brainPerformanceProvider(balance)),
                ),
              ],
            ),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: _CapitalRow(balance: balance),
              ),
            ),

            SliverToBoxAdapter(
              child: perfAsync.when(
                loading: () => const SizedBox(
                  height: 300,
                  child: Center(child: CircularProgressIndicator(
                      color: AppColors.primary, strokeWidth: 2)),
                ),
                error: (e, _) => Padding(
                  padding: const EdgeInsets.all(24),
                  child: _ErrorView(
                    error: e.toString(),
                    onRetry: () => ref.invalidate(brainPerformanceProvider(balance)),
                  ),
                ),
                data: (r) => _PerformanceBody(report: r),
              ),
            ),

            const SliverPadding(padding: EdgeInsets.only(bottom: 32)),
          ],
        ),
      ),
    );
  }
}

// ── Capital selector ──────────────────────────────────────────────────────────

class _CapitalRow extends ConsumerWidget {
  final double balance;
  const _CapitalRow({required this.balance});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [100, 500, 1000, 5000].map((v) {
          final selected = balance == v.toDouble();
          return Expanded(
            child: GestureDetector(
              onTap: () =>
                  ref.read(brainBalanceProvider.notifier).set(v.toDouble()),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                margin: const EdgeInsets.only(right: 6),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: selected
                      ? AppColors.buy.withValues(alpha: 0.2)
                      : AppColors.card,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                      color: selected ? AppColors.buy : AppColors.border),
                ),
                child: Text('\$$v',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight:
                          selected ? FontWeight.w700 : FontWeight.normal,
                      color:
                          selected ? AppColors.buy : AppColors.textSecondary,
                    )),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ── Main body ─────────────────────────────────────────────────────────────────

class _PerformanceBody extends StatelessWidget {
  final PerformanceReport report;
  const _PerformanceBody({required this.report});

  @override
  Widget build(BuildContext context) {
    final r            = report;
    final profitPos    = r.netProfit >= 0;
    final profitColor  = profitPos ? AppColors.buy : AppColors.sell;

    if (r.message != null && r.totalTrades == 0) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Container(
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(children: [
            const Icon(Icons.hourglass_top, size: 48, color: AppColors.textMuted),
            const SizedBox(height: 16),
            Text(r.message!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          ]),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(children: [

        // ── Hero balance card ─────────────────────────────────────────────
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: profitColor.withValues(alpha: 0.4), width: 1.5),
            gradient: LinearGradient(
              begin: Alignment.topLeft, end: Alignment.bottomRight,
              colors: [profitColor.withValues(alpha: 0.07), AppColors.card],
            ),
          ),
          child: Column(children: [
            const Text('If you followed every AI decision',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(height: 10),
            Text('\$${r.currentBalance.toStringAsFixed(2)}',
                style: TextStyle(fontSize: 38, fontWeight: FontWeight.w900,
                    color: profitColor)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              decoration: BoxDecoration(
                color: profitColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '${profitPos ? '+' : ''}\$${r.netProfit.toStringAsFixed(2)} '
                '(${profitPos ? '+' : ''}${r.netProfitPercent.toStringAsFixed(1)}%)',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700,
                    color: profitColor),
              ),
            ),
            const SizedBox(height: 4),
            Text('starting from \$${r.startingBalance.toStringAsFixed(0)}',
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ]),
        ),

        const SizedBox(height: 12),

        // ── Period + win rate row ─────────────────────────────────────────
        Row(children: [
          Expanded(child: _StatBox(
            label: '24h Profit',
            child: _PeriodValue(value: r.last24hProfit),
          )),
          const SizedBox(width: 8),
          Expanded(child: _StatBox(
            label: '7d Profit',
            child: _PeriodValue(value: r.last7dProfit),
          )),
          const SizedBox(width: 8),
          Expanded(child: _StatBox(
            label: 'Win Rate',
            child: Text('${r.winRate}%',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                    color: r.winRate >= 50 ? AppColors.buy : AppColors.sell)),
          )),
        ]),

        const SizedBox(height: 8),

        // ── Trades grid ───────────────────────────────────────────────────
        Row(children: [
          Expanded(child: _StatBox(
            label: 'Total Trades',
            child: Text('${r.totalTrades}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                    color: AppColors.primary)),
          )),
          const SizedBox(width: 8),
          Expanded(child: _StatBox(
            label: 'Won',
            child: Text('${r.winTrades}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                    color: AppColors.buy)),
          )),
          const SizedBox(width: 8),
          Expanded(child: _StatBox(
            label: 'Lost',
            child: Text('${r.lossTrades}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                    color: AppColors.sell)),
          )),
          const SizedBox(width: 8),
          Expanded(child: _StatBox(
            label: 'Open',
            child: Text('${r.openTrades}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800,
                    color: AppColors.hold)),
          )),
        ]),

        const SizedBox(height: 12),

        // ── Equity curve ─────────────────────────────────────────────────
        if (r.equityCurve.length > 1) ...[
          Container(
            padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Padding(
                padding: EdgeInsets.only(left: 4, bottom: 12),
                child: Text('Equity Curve',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
              ),
              _EquityCurve(
                curve: r.equityCurve,
                capital: r.startingBalance,
                profitColor: profitColor,
              ),
            ]),
          ),
          const SizedBox(height: 12),
        ],

        // ── Win / Loss bar ────────────────────────────────────────────────
        if (r.totalTrades > 0) ...[
          _WinLossBar(wins: r.winTrades, losses: r.lossTrades),
          const SizedBox(height: 12),
        ],

        // ── Decision history ──────────────────────────────────────────────
        if (r.recentDecisions.isNotEmpty) ...[
          Container(
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 14, 16, 4),
                child: Text('AI Decision History',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
              ),
              ...r.recentDecisions.map((d) => _DecisionRow(decision: d)),
              const SizedBox(height: 4),
            ]),
          ),
          const SizedBox(height: 12),
        ],
      ]),
    );
  }
}

// ── Equity curve with touch ───────────────────────────────────────────────────

class _EquityCurve extends StatefulWidget {
  final List<dynamic> curve;
  final double capital;
  final Color  profitColor;
  const _EquityCurve({
    required this.curve, required this.capital, required this.profitColor});

  @override
  State<_EquityCurve> createState() => _EquityCurveState();
}

class _EquityCurveState extends State<_EquityCurve> {
  int? _touched;

  @override
  Widget build(BuildContext context) {
    final spots = widget.curve.asMap().entries.map((e) {
      final b = (e.value.balance as double);
      return FlSpot(e.key.toDouble(), b);
    }).toList();

    final balances = widget.curve.map((p) => p.balance as double).toList();
    final minY = balances.reduce((a, b) => a < b ? a : b);
    final maxY = balances.reduce((a, b) => a > b ? a : b);
    final pad  = ((maxY - minY) * 0.18) + 1;

    return SizedBox(
      height: 160,
      child: LineChart(LineChartData(
        minY: minY - pad,
        maxY: maxY + pad,
        gridData: FlGridData(
          show: true,
          drawHorizontalLine: true,
          drawVerticalLine: false,
          getDrawingHorizontalLine: (_) =>
              FlLine(color: AppColors.border.withValues(alpha: 0.5), strokeWidth: 0.5),
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 52,
              getTitlesWidget: (v, _) => Text(
                '\$${v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}k' : v.toStringAsFixed(0)}',
                style: const TextStyle(fontSize: 9, color: AppColors.textMuted),
              ),
            ),
          ),
          rightTitles:  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles:    const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        lineTouchData: LineTouchData(
          touchCallback: (event, response) {
            if (response?.lineBarSpots != null) {
              setState(() =>
                  _touched = response!.lineBarSpots!.first.spotIndex);
            } else if (event is FlPointerExitEvent ||
                       event is FlTapUpEvent ||
                       event is FlLongPressEnd) {
              setState(() => _touched = null);
            }
          },
          touchTooltipData: LineTouchTooltipData(
            getTooltipColor: (_) => AppColors.card,
            tooltipBorder: const BorderSide(color: AppColors.border),
            getTooltipItems: (spots) => spots.map((s) {
              final b = s.y;
              final diff = b - widget.capital;
              final pct  = (diff / widget.capital * 100);
              return LineTooltipItem(
                '\$${b.toStringAsFixed(2)}\n',
                TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                    color: widget.profitColor),
                children: [
                  TextSpan(
                    text: '${diff >= 0 ? '+' : ''}\$${diff.toStringAsFixed(2)} '
                          '(${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(1)}%)',
                    style: const TextStyle(fontSize: 10,
                        color: AppColors.textSecondary),
                  ),
                ],
              );
            }).toList(),
          ),
        ),
        lineBarsData: [
          // Capital baseline
          LineChartBarData(
            spots: [
              FlSpot(0, widget.capital),
              FlSpot((widget.curve.length - 1).toDouble(), widget.capital),
            ],
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
            color: widget.profitColor,
            barWidth: 2.5,
            dotData: FlDotData(
              show: true,
              getDotPainter: (spot, _, __, index) => FlDotCirclePainter(
                radius: index == _touched ? 5 : 0,
                color: widget.profitColor,
                strokeColor: AppColors.card,
                strokeWidth: index == _touched ? 2 : 0,
              ),
            ),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                begin: Alignment.topCenter, end: Alignment.bottomCenter,
                colors: [
                  widget.profitColor.withValues(alpha: 0.25),
                  widget.profitColor.withValues(alpha: 0.0),
                ],
              ),
            ),
          ),
        ],
      )),
    );
  }
}

// ── Win/Loss bar ──────────────────────────────────────────────────────────────

class _WinLossBar extends StatelessWidget {
  final int wins;
  final int losses;
  const _WinLossBar({required this.wins, required this.losses});

  @override
  Widget build(BuildContext context) {
    final total   = wins + losses;
    final winFrac = total > 0 ? wins / total : 0.0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('$wins Wins',
              style: const TextStyle(fontSize: 12, color: AppColors.buy,
                  fontWeight: FontWeight.w600)),
          Text('$losses Losses',
              style: const TextStyle(fontSize: 12, color: AppColors.sell,
                  fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Row(children: [
            Expanded(
              flex: (winFrac * 100).round().clamp(1, 99),
              child: Container(height: 8, color: AppColors.buy),
            ),
            Expanded(
              flex: 100 - (winFrac * 100).round().clamp(1, 99),
              child: Container(height: 8, color: AppColors.sell),
            ),
          ]),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text('${(winFrac * 100).toStringAsFixed(1)}% win rate',
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ),
      ]),
    );
  }
}

// ── Decision row ──────────────────────────────────────────────────────────────

class _DecisionRow extends StatelessWidget {
  final RecentDecision decision;
  const _DecisionRow({required this.decision});

  Color get _resultColor {
    switch (decision.result) {
      case 'WIN':  return AppColors.buy;
      case 'LOSS': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  Color get _actionColor {
    switch (decision.action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasPct = decision.profitPct != null && decision.result != 'OPEN';
    final pct    = decision.profitPct ?? 0.0;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: Row(children: [
        // Result badge
        Container(
          width: 46,
          padding: const EdgeInsets.symmetric(vertical: 5),
          decoration: BoxDecoration(
            color: _resultColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(decision.result,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                  color: _resultColor)),
        ),
        const SizedBox(width: 12),
        // Asset + action
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(decision.displayName,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary)),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: _actionColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(decision.action,
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                      color: _actionColor)),
            ),
          ]),
          const SizedBox(height: 2),
          Text('${decision.confidence}% confidence',
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ])),
        // P&L / LIVE badge
        if (hasPct)
          Text('${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(1)}%',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: pct >= 0 ? AppColors.buy : AppColors.sell))
        else if (decision.result == 'OPEN')
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.hold.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text('LIVE',
                style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                    color: AppColors.hold)),
          ),
      ]),
    );
  }
}

// ── Helper widgets ────────────────────────────────────────────────────────────

class _StatBox extends StatelessWidget {
  final String label;
  final Widget child;
  const _StatBox({required this.label, required this.child});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(children: [
      child,
      const SizedBox(height: 4),
      Text(label, style: const TextStyle(fontSize: 9, color: AppColors.textMuted)),
    ]),
  );
}

class _PeriodValue extends StatelessWidget {
  final double value;
  const _PeriodValue({required this.value});

  @override
  Widget build(BuildContext context) {
    final pos   = value >= 0;
    final color = pos ? AppColors.buy : AppColors.sell;
    return Text(
      '${pos ? '+' : ''}\$${value.abs().toStringAsFixed(2)}',
      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: color),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.cloud_off, color: AppColors.textMuted, size: 48),
      const SizedBox(height: 12),
      Text(error,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      const SizedBox(height: 16),
      ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
    ]),
  );
}
