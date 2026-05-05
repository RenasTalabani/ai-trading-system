import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/providers/brain_analytics_provider.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/providers/brain_stats_provider.dart';
import '../../core/theme/app_theme.dart';
import '../brain/achievements_sheet.dart';
import '../brain/my_trades_sheet.dart';

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

            // ── Asset Analytics ───────────────────────────────────────────
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: const _AssetAnalyticsCard(),
              ),
            ),

            // ── AI Performance Calendar ───────────────────────────────────
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: _AiCalendarCard(),
              ),
            ),

            // ── My Follows section ────────────────────────────────────────
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: _MyFollowsCard(),
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
            label: 'Total',
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
          if (r.avgProfitPct != null)
            Expanded(child: _StatBox(
              label: 'Avg P&L',
              child: Text(
                '${r.avgProfitPct! >= 0 ? '+' : ''}${r.avgProfitPct!.toStringAsFixed(1)}%',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                    color: r.avgProfitPct! >= 0 ? AppColors.buy : AppColors.sell),
              ),
            ))
          else
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

// ── My Follows card ───────────────────────────────────────────────────────────

class _MyFollowsCard extends ConsumerWidget {
  const _MyFollowsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state  = ref.watch(followsProvider);
    final open   = state.follows.where((f) => f.isOpen).toList();
    final closed = state.follows.where((f) => !f.isOpen).toList();
    final wins   = closed.where((f) => f.outcome == 'WIN').length;
    final wr     = closed.isNotEmpty
        ? (wins / closed.length * 100).round() : 0;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Row(children: [
            const Icon(Icons.add_chart_outlined, size: 16,
                color: AppColors.primary),
            const SizedBox(width: 8),
            const Text('My Followed Trades',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            GestureDetector(
              onTap: () => showMyTradesSheet(context),
              child: const Text('View all',
                  style: TextStyle(fontSize: 12, color: AppColors.primary,
                      fontWeight: FontWeight.w600)),
            ),
          ]),
        ),

        // Stats row
        if (state.follows.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(children: [
              _FolStat(label: 'Total', value: '${state.follows.length}',
                  color: AppColors.primary),
              _FolStat(label: 'Open', value: '${open.length}',
                  color: AppColors.hold),
              _FolStat(label: 'Closed', value: '${closed.length}',
                  color: AppColors.textSecondary),
              _FolStat(label: 'Win Rate',
                  value: closed.isNotEmpty ? '$wr%' : '—',
                  color: wr >= 50 ? AppColors.buy : AppColors.sell),
            ]),
          ),
        ],

        // Open follows preview (up to 3)
        if (open.isNotEmpty) ...[
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Text('OPEN',
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
                    color: AppColors.textMuted, letterSpacing: 1.2)),
          ),
          ...open.take(3).map((f) => _FollowMiniRow(follow: f)),
        ],

        // Empty state
        if (state.follows.isEmpty)
          const Padding(
            padding: EdgeInsets.all(20),
            child: Row(children: [
              Icon(Icons.info_outline, size: 16,
                  color: AppColors.textMuted),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Tap "Follow This Trade" on the Brain screen to track your trades here.',
                  style: TextStyle(fontSize: 12,
                      color: AppColors.textSecondary),
                ),
              ),
            ]),
          ),

        const SizedBox(height: 14),
      ]),
    );
  }
}

class _FolStat extends StatelessWidget {
  final String label, value;
  final Color  color;
  const _FolStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(children: [
      Text(value,
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
              color: color)),
      const SizedBox(height: 2),
      Text(label,
          style: const TextStyle(fontSize: 9, color: AppColors.textMuted)),
    ]),
  );
}

// ── Asset Analytics Card ──────────────────────────────────────────────────────

class _AssetAnalyticsCard extends ConsumerWidget {
  const _AssetAnalyticsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final analyticsAsync = ref.watch(brainAnalyticsProvider);

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Row(children: [
            const Icon(Icons.bar_chart_rounded, size: 14, color: AppColors.primary),
            const SizedBox(width: 8),
            const Text('AI Performance by Asset',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            analyticsAsync.whenOrNull(data: (a) => Text(
              '${a.assets.length} assets',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
            )) ?? const SizedBox.shrink(),
          ]),
        ),

        const SizedBox(height: 12),

        analyticsAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator(
                color: AppColors.primary, strokeWidth: 2)),
          ),
          error: (_, __) => const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text('Analytics unavailable',
                style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
          ),
          data: (analytics) {
            if (analytics.assets.isEmpty) {
              return const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Text('No evaluated trades yet',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
              );
            }

            return Column(children: [
              // Overall summary strip
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(children: [
                  _AnaStat('Total Trades', '${analytics.overall.total}',
                      AppColors.primary),
                  const SizedBox(width: 8),
                  _AnaStat('Overall W%', '${analytics.overall.winRate}%',
                      analytics.overall.winRate >= 60
                          ? AppColors.buy : AppColors.sell),
                  const SizedBox(width: 8),
                  if (analytics.overall.avgProfitPct != null)
                    _AnaStat('Avg P&L',
                        '${analytics.overall.avgProfitPct! >= 0 ? '+' : ''}${analytics.overall.avgProfitPct!.toStringAsFixed(1)}%',
                        analytics.overall.avgProfitPct! >= 0
                            ? AppColors.buy : AppColors.sell),
                ]),
              ),

              const Divider(color: AppColors.border, height: 1),

              // Per-asset rows
              ...analytics.assets.map((a) => _AssetAnalyticsRow(asset: a)),

              const SizedBox(height: 4),
            ]);
          },
        ),
      ]),
    );
  }
}

class _AssetAnalyticsRow extends StatelessWidget {
  final AssetAnalytics asset;
  const _AssetAnalyticsRow({required this.asset});

  Color get _gradeColor {
    switch (asset.grade) {
      case 'S': return const Color(0xFFFFD700);
      case 'A': return AppColors.buy;
      case 'B': return AppColors.primary;
      case 'C': return AppColors.hold;
      default:  return AppColors.sell;
    }
  }

  @override
  Widget build(BuildContext context) {
    final winFrac = asset.total > 0 ? asset.wins / asset.total : 0.0;
    final profitPos = asset.avgProfitPct >= 0;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: Row(children: [
        // Grade badge
        Container(
          width: 28, height: 28,
          decoration: BoxDecoration(
            color: _gradeColor.withValues(alpha: 0.15),
            shape: BoxShape.circle,
            border: Border.all(color: _gradeColor.withValues(alpha: 0.4)),
          ),
          child: Center(
            child: Text(asset.grade,
                style: TextStyle(color: _gradeColor,
                    fontSize: 11, fontWeight: FontWeight.w900)),
          ),
        ),
        const SizedBox(width: 10),

        // Name + win/loss bar
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(asset.displayName,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 4),
          Row(children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(3),
                child: LinearProgressIndicator(
                  value: winFrac,
                  backgroundColor: AppColors.sell.withValues(alpha: 0.25),
                  valueColor: AlwaysStoppedAnimation(
                      AppColors.buy.withValues(alpha: 0.8)),
                  minHeight: 4,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Text('${asset.wins}W ${asset.losses}L',
                style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
          ]),
        ])),
        const SizedBox(width: 12),

        // Win rate
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${asset.winRate}%',
              style: TextStyle(
                  fontSize: 15, fontWeight: FontWeight.w800,
                  color: asset.winRate >= 60 ? AppColors.buy : AppColors.sell)),
          Text(
            '${profitPos ? '+' : ''}${asset.avgProfitPct.toStringAsFixed(1)}% avg',
            style: TextStyle(
                fontSize: 10,
                color: profitPos ? AppColors.buy : AppColors.sell),
          ),
        ]),
      ]),
    );
  }
}

class _AnaStat extends StatelessWidget {
  final String label, value;
  final Color  color;
  const _AnaStat(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(children: [
        Text(value, style: TextStyle(color: color,
            fontWeight: FontWeight.w800, fontSize: 14)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(
            color: AppColors.textMuted, fontSize: 9)),
      ]),
    ),
  );
}

// ── AI Performance Calendar ───────────────────────────────────────────────────

class _AiCalendarCard extends ConsumerWidget {
  const _AiCalendarCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(brainStatsProvider);

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Header row
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 0),
          child: Row(children: [
            const Icon(Icons.calendar_today_outlined,
                size: 14, color: AppColors.primary),
            const SizedBox(width: 8),
            const Text('30-Day Performance',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
            const Spacer(),
            GestureDetector(
              onTap: () => showAchievementsSheet(context),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Row(mainAxisSize: MainAxisSize.min, children: [
                  Text('🏆', style: TextStyle(fontSize: 11)),
                  SizedBox(width: 4),
                  Text('Achievements',
                      style: TextStyle(fontSize: 11, color: AppColors.primary,
                          fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
          ]),
        ),

        const SizedBox(height: 14),

        statsAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Center(child: SizedBox(width: 20, height: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.primary))),
          ),
          error: (_, __) => const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text('Calendar unavailable',
                style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
          ),
          data: (stats) => Column(children: [
            // Weekly accuracy strip
            if (stats.weeklyAccuracy != null) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(children: [
                  _CalStat('This Week', '${stats.weeklyAccuracy}%',
                      stats.weeklyAccuracy! >= 60 ? AppColors.buy : AppColors.sell),
                  const SizedBox(width: 8),
                  _CalStat('Best Streak', '${stats.bestStreak}🔥',
                      AppColors.hold),
                  const SizedBox(width: 8),
                  _CalStat('All-time W%', '${stats.winRate}%',
                      stats.winRate >= 60 ? AppColors.buy : AppColors.sell),
                ]),
              ),
            ],

            // Heatmap grid
            if (stats.heatmap.isEmpty)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Text('No closed trades in the last 30 days',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
              )
            else
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: _HeatmapGrid(days: stats.heatmap),
              ),

            // Legend
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              child: Row(children: [
                _LegendDot(AppColors.buy,  'Win'),
                const SizedBox(width: 12),
                _LegendDot(AppColors.sell, 'Loss'),
                const SizedBox(width: 12),
                _LegendDot(AppColors.hold, 'Mixed'),
              ]),
            ),
          ]),
        ),
      ]),
    );
  }
}

class _HeatmapGrid extends StatelessWidget {
  final List<HeatmapDay> days;
  const _HeatmapGrid({required this.days});

  @override
  Widget build(BuildContext context) {
    // Build a map of date → day for fast lookup
    final map = { for (final d in days) d.date: d };

    // Generate last 35 days (5 weeks) as a grid
    final now   = DateTime.now();
    final cells  = List.generate(35, (i) {
      final date = now.subtract(Duration(days: 34 - i));
      final key  = '${date.year}-${date.month.toString().padLeft(2,'0')}-${date.day.toString().padLeft(2,'0')}';
      return (date: date, day: map[key]);
    });

    return Wrap(
      spacing: 5,
      runSpacing: 5,
      children: cells.map((c) {
        final d = c.day;
        Color color;
        if (d == null) {
          color = AppColors.surface;
        } else if (d.result == 'WIN') {
          color = AppColors.buy.withValues(alpha: 0.7);
        } else if (d.result == 'LOSS') {
          color = AppColors.sell.withValues(alpha: 0.7);
        } else {
          color = AppColors.hold.withValues(alpha: 0.7);
        }

        return Tooltip(
          message: d != null
              ? '${c.date.day}/${c.date.month} · ${d.wins}W ${d.losses}L'
              : '${c.date.day}/${c.date.month}',
          child: Container(
            width: 24, height: 24,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _CalStat extends StatelessWidget {
  final String label, value;
  final Color  color;
  const _CalStat(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(children: [
        Text(value, style: TextStyle(color: color,
            fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(
            color: AppColors.textMuted, fontSize: 9)),
      ]),
    ),
  );
}

class _LegendDot extends StatelessWidget {
  final Color  color;
  final String label;
  const _LegendDot(this.color, this.label);

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(width: 10, height: 10,
          decoration: BoxDecoration(
              color: color.withValues(alpha: 0.7),
              borderRadius: BorderRadius.circular(2))),
      const SizedBox(width: 4),
      Text(label, style: const TextStyle(
          color: AppColors.textMuted, fontSize: 10)),
    ],
  );
}

class _FollowMiniRow extends ConsumerWidget {
  final UserFollow follow;
  const _FollowMiniRow({required this.follow});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ac = follow.action == 'BUY' ? AppColors.buy
        : follow.action == 'SELL' ? AppColors.sell : AppColors.hold;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: const BoxDecoration(
        border: Border(
            top: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: ac.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(follow.action,
              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                  color: ac)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(follow.displayName,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary)),
        ),
        Text('${follow.confidence}% conf',
            style: const TextStyle(fontSize: 11,
                color: AppColors.textMuted)),
        const SizedBox(width: 12),
        // Quick close buttons
        GestureDetector(
          onTap: () => ref.read(followsProvider.notifier)
              .closeTrade(follow.id, outcome: 'WIN'),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.buy.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text('W',
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800,
                    color: AppColors.buy)),
          ),
        ),
        const SizedBox(width: 6),
        GestureDetector(
          onTap: () => ref.read(followsProvider.notifier)
              .closeTrade(follow.id, outcome: 'LOSS'),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.sell.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text('L',
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800,
                    color: AppColors.sell)),
          ),
        ),
      ]),
    );
  }
}
