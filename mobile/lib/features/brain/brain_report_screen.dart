import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';

class BrainReportScreen extends ConsumerStatefulWidget {
  const BrainReportScreen({super.key});

  @override
  ConsumerState<BrainReportScreen> createState() => _BrainReportScreenState();
}

class _BrainReportScreenState extends ConsumerState<BrainReportScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(minutes: 30), (_) {
      if (!mounted) return;
      final balance = ref.read(brainBalanceProvider);
      ref.invalidate(brainActionProvider);
      ref.invalidate(brainPerformanceProvider(balance));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final balance = ref.read(brainBalanceProvider);
    ref.invalidate(brainActionProvider);
    ref.invalidate(brainPerformanceProvider(balance));
  }

  @override
  Widget build(BuildContext context) {
    final balance      = ref.watch(brainBalanceProvider);
    final actionAsync  = ref.watch(brainActionProvider);
    final perfAsync    = ref.watch(brainPerformanceProvider(balance));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: RefreshIndicator(
        onRefresh: _refresh,
        color: AppColors.primary,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            // App bar
            SliverAppBar(
              floating: true,
              snap: true,
              backgroundColor: AppColors.background,
              title: Row(children: [
                Container(
                  width: 8, height: 8,
                  decoration: const BoxDecoration(
                    color: AppColors.buy, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
                const Text('AI Brain',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.refresh, size: 20,
                      color: AppColors.textSecondary),
                  onPressed: _refresh,
                ),
              ]),
            ),

            // ── REPORT 1: WHAT TO DO ────────────────────────────────────────
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 4, 16, 0),
                child: _SectionHeader(
                  label: 'REPORT 1',
                  title: 'What To Do',
                  icon: Icons.bolt,
                  color: AppColors.primary,
                ),
              ),
            ),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                child: actionAsync.when(
                  loading: () => const _LoadingCard(height: 240),
                  error:   (e, _) => _ErrorCard(
                    message: e.toString(), onRetry: () => ref.invalidate(brainActionProvider)),
                  data:    (r) => _ActionReportCard(report: r),
                ),
              ),
            ),

            // ── REPORT 2: IF YOU FOLLOWED AI ───────────────────────────────
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 24, 16, 0),
                child: _SectionHeader(
                  label: 'REPORT 2',
                  title: 'If You Followed AI',
                  icon: Icons.savings_outlined,
                  color: AppColors.buy,
                ),
              ),
            ),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                child: _CapitalRow(balance: balance),
              ),
            ),

            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                child: perfAsync.when(
                  loading: () => const _LoadingCard(height: 200),
                  error:   (e, _) => _ErrorCard(
                    message: e.toString(),
                    onRetry: () => ref.invalidate(brainPerformanceProvider(balance))),
                  data:    (r) => _PerformanceReportCard(report: r),
                ),
              ),
            ),

            const SliverPadding(padding: EdgeInsets.only(bottom: 32)),
          ],
        ),
      ),
    );
  }
}

// ── Section header ────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String  label;
  final String  title;
  final IconData icon;
  final Color   color;
  const _SectionHeader({
    required this.label, required this.title,
    required this.icon, required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(label,
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900,
                color: color, letterSpacing: 1.2)),
      ),
      const SizedBox(width: 10),
      Icon(icon, size: 15, color: color),
      const SizedBox(width: 6),
      Text(title,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700,
              color: AppColors.textPrimary)),
    ]);
  }
}

// ── Report 1: Action card ─────────────────────────────────────────────────────

class _ActionReportCard extends StatefulWidget {
  final ActionReport report;
  const _ActionReportCard({required this.report});

  @override
  State<_ActionReportCard> createState() => _ActionReportCardState();
}

class _ActionReportCardState extends State<_ActionReportCard> {
  bool _showFullReason = false;

  Color get _actionColor {
    switch (widget.report.action) {
      case 'BUY':  return AppColors.buy;
      case 'SELL': return AppColors.sell;
      default:     return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.report;
    final c = _actionColor;

    return Container(
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

        // ── Hero: asset + action ─────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.all(20),
          child: Row(children: [
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(r.displayName,
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Row(children: [
                  _ClassBadge(cls: r.assetClass),
                  const SizedBox(width: 6),
                  Text(r.timeframe,
                      style: const TextStyle(fontSize: 11,
                          color: AppColors.textSecondary)),
                ]),
              ],
            )),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
              decoration: BoxDecoration(
                color: c, borderRadius: BorderRadius.circular(14)),
              child: Text(r.action,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900,
                      color: Colors.white, letterSpacing: 1.5)),
            ),
          ]),
        ),

        // ── Confidence bar ───────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Text('${r.confidence}% confidence',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                        color: c)),
                const Spacer(),
                if (r.expectedProfitPercent != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.buy.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text('Est. ${r.expectedProfitPercent}',
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                            color: AppColors.buy)),
                  ),
              ]),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: r.confidence / 100,
                  minHeight: 6,
                  backgroundColor: AppColors.border,
                  valueColor: AlwaysStoppedAnimation(c),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 16),
        const Divider(color: AppColors.border, height: 1),

        // ── Trade levels ─────────────────────────────────────────────────
        if (r.entryPrice != null || r.stopLoss != null || r.takeProfit != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
            child: Row(children: [
              if (r.entryPrice != null)
                _LevelTile(label: 'Entry', value: _fmt(r.entryPrice!),
                    color: AppColors.primary),
              if (r.stopLoss != null)
                _LevelTile(label: 'Stop Loss', value: _fmt(r.stopLoss!),
                    color: AppColors.sell),
              if (r.takeProfit != null)
                _LevelTile(label: 'Take Profit', value: _fmt(r.takeProfit!),
                    color: AppColors.buy),
              if (r.riskReward != null)
                _LevelTile(label: 'RR', value: r.riskReward!,
                    color: AppColors.textPrimary),
            ]),
          ),
          const SizedBox(height: 14),
          const Divider(color: AppColors.border, height: 1),
        ],

        // ── Macro context row ────────────────────────────────────────────
        if (r.fearGreed != null || r.macroSentiment != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
            child: Row(children: [
              const Icon(Icons.public, size: 13, color: AppColors.textMuted),
              const SizedBox(width: 6),
              if (r.fearGreed != null) ...[
                _MacroChip(
                  label: 'Fear & Greed: ${r.fearGreed}',
                  color: r.fearGreed! >= 65
                      ? AppColors.buy
                      : r.fearGreed! <= 35
                          ? AppColors.sell
                          : AppColors.hold,
                ),
                const SizedBox(width: 8),
              ],
              if (r.macroSentiment != null)
                _MacroChip(
                  label: r.macroSentiment!.toUpperCase(),
                  color: r.macroSentiment == 'bullish'
                      ? AppColors.buy
                      : r.macroSentiment == 'bearish'
                          ? AppColors.sell
                          : AppColors.hold,
                ),
              const Spacer(),
              if (r.aiAccuracy != null)
                Text('AI accuracy: ${r.aiAccuracy}%',
                    style: const TextStyle(fontSize: 10,
                        color: AppColors.textMuted)),
            ]),
          ),
          const SizedBox(height: 12),
          const Divider(color: AppColors.border, height: 1),
        ],

        // ── Full Reason ──────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Icon(Icons.lightbulb_outline, size: 13, color: AppColors.warning),
              SizedBox(width: 6),
              Text('Why',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
            ]),
            const SizedBox(height: 8),
            Text(r.reason,
                maxLines: _showFullReason ? 100 : 3,
                overflow: _showFullReason
                    ? TextOverflow.visible : TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, color: AppColors.textSecondary,
                    height: 1.6)),
            if (r.reason.length > 120) ...[
              const SizedBox(height: 6),
              GestureDetector(
                onTap: () => setState(() => _showFullReason = !_showFullReason),
                child: Text(
                  _showFullReason ? 'Show less' : 'Read more',
                  style: const TextStyle(fontSize: 12,
                      color: AppColors.primary, fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ]),
        ),

        // ── Top picks strip ──────────────────────────────────────────────
        if (r.topPicks.isNotEmpty) ...[
          const Divider(color: AppColors.border, height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Other opportunities',
                    style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6, runSpacing: 6,
                  children: r.topPicks.map((p) => _PickChip(pick: p)).toList(),
                ),
              ],
            ),
          ),
        ],

        if (r.generatedAt != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            child: Text(
              'Updated ${_timeAgo(r.generatedAt!)}',
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
            ),
          ),
        ],
      ]),
    );
  }

  String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }

  String _timeAgo(DateTime dt) {
    final d = DateTime.now().difference(dt);
    if (d.inMinutes < 1)  return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes}m ago';
    return '${d.inHours}h ago';
  }
}

// ── Report 2: Capital selector row ───────────────────────────────────────────

class _CapitalRow extends ConsumerWidget {
  final double balance;
  const _CapitalRow({required this.balance});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Row(
      children: [100, 500, 1000, 5000].map((v) {
        final selected = balance == v.toDouble();
        return Expanded(
          child: GestureDetector(
            onTap: () => ref.read(brainBalanceProvider.notifier).state = v.toDouble(),
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
                    fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
                    color: selected ? AppColors.buy : AppColors.textSecondary,
                  )),
            ),
          ),
        );
      }).toList(),
    );
  }
}

// ── Report 2: Performance card ────────────────────────────────────────────────

class _PerformanceReportCard extends StatelessWidget {
  final PerformanceReport report;
  const _PerformanceReportCard({required this.report});

  @override
  Widget build(BuildContext context) {
    final r              = report;
    final profitPositive = r.netProfit >= 0;
    final profitColor    = profitPositive ? AppColors.buy : AppColors.sell;

    if (r.message != null && r.totalTrades == 0) {
      return Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(children: [
          const Icon(Icons.hourglass_top, size: 40, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text(r.message!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary)),
        ]),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: profitColor.withValues(alpha: 0.3), width: 1.5),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [

        // ── Hero balance ─────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(children: [
            const Text('Your balance would be',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(height: 8),
            Text('\$${r.currentBalance.toStringAsFixed(2)}',
                style: TextStyle(fontSize: 36, fontWeight: FontWeight.w900,
                    color: profitColor)),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: profitColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                '${profitPositive ? '+' : ''}\$${r.netProfit.toStringAsFixed(2)} '
                '(${profitPositive ? '+' : ''}${r.netProfitPercent.toStringAsFixed(1)}%)',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                    color: profitColor),
              ),
            ),
            const SizedBox(height: 4),
            Text('starting from \$${r.startingBalance.toStringAsFixed(0)}',
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ]),
        ),

        const Divider(color: AppColors.border, height: 1),

        // ── Period stats ─────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          child: Row(children: [
            _PeriodStat(
              label: '24h',
              value: r.last24hProfit,
            ),
            _VertDivider(),
            _PeriodStat(
              label: '7 days',
              value: r.last7dProfit,
            ),
            _VertDivider(),
            Expanded(child: Column(children: [
              Text('${r.winRate}%',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                      color: r.winRate >= 50 ? AppColors.buy : AppColors.sell)),
              const Text('Win Rate',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ])),
          ]),
        ),

        const Divider(color: AppColors.border, height: 1),

        // ── Trades summary ───────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _MiniStat(label: 'Total', value: '${r.totalTrades}',
                  color: AppColors.primary),
              _MiniStat(label: 'Won', value: '${r.winTrades}',
                  color: AppColors.buy),
              _MiniStat(label: 'Lost', value: '${r.lossTrades}',
                  color: AppColors.sell),
              _MiniStat(label: 'Open', value: '${r.openTrades}',
                  color: AppColors.hold),
            ],
          ),
        ),

        // ── Equity curve ─────────────────────────────────────────────────
        if (r.equityCurve.length > 1) ...[
          const Divider(color: AppColors.border, height: 1),
          Padding(
            padding: const EdgeInsets.all(16),
            child: _MiniEquityCurve(
              curve: r.equityCurve,
              capital: r.startingBalance,
              profitColor: profitColor,
            ),
          ),
        ],

        // ── Recent decisions ─────────────────────────────────────────────
        if (r.recentDecisions.isNotEmpty) ...[
          const Divider(color: AppColors.border, height: 1),
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 14, 20, 4),
            child: Text('Recent AI Decisions',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
          ),
          ...r.recentDecisions.take(5).map((d) => _DecisionRow(decision: d)),
          const SizedBox(height: 8),
        ],
      ]),
    );
  }
}

class _PeriodStat extends StatelessWidget {
  final String label;
  final double value;
  const _PeriodStat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final pos   = value >= 0;
    final color = pos ? AppColors.buy : AppColors.sell;
    return Expanded(child: Column(children: [
      Text('${pos ? '+' : ''}\$${value.abs().toStringAsFixed(2)}',
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: color)),
      const SizedBox(height: 2),
      Text(label,
          style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
    ]));
  }
}

class _VertDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) =>
      Container(width: 1, height: 32, color: AppColors.border,
          margin: const EdgeInsets.symmetric(horizontal: 8));
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _MiniStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Column(children: [
    Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
    const SizedBox(height: 2),
    Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
  ]);
}

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

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
      child: Row(children: [
        Container(
          width: 44,
          padding: const EdgeInsets.symmetric(vertical: 4),
          decoration: BoxDecoration(
            color: _resultColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(decision.result,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800,
                  color: _resultColor)),
        ),
        const SizedBox(width: 10),
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
          Text('${decision.confidence}% confidence',
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ])),
        if (hasPct)
          Text('${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(1)}%',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: pct >= 0 ? AppColors.buy : AppColors.sell))
        else if (decision.result == 'OPEN')
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.hold.withValues(alpha: 0.1),
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

// ── Mini equity curve ─────────────────────────────────────────────────────────

class _MiniEquityCurve extends StatelessWidget {
  final List<dynamic> curve;
  final double capital;
  final Color  profitColor;
  const _MiniEquityCurve({
    required this.curve, required this.capital, required this.profitColor});

  @override
  Widget build(BuildContext context) {
    final spots = curve.asMap().entries.map((e) {
      final balance = (e.value.balance as double);
      return FlSpot(e.key.toDouble(), balance);
    }).toList();

    final balances = curve.map((p) => p.balance as double).toList();
    final minY  = balances.reduce((a, b) => a < b ? a : b);
    final maxY  = balances.reduce((a, b) => a > b ? a : b);
    final pad   = ((maxY - minY) * 0.15) + 1;

    return SizedBox(
      height: 100,
      child: LineChart(LineChartData(
        minY: minY - pad,
        maxY: maxY + pad,
        gridData: const FlGridData(show: false),
        borderData: FlBorderData(show: false),
        titlesData: const FlTitlesData(
          leftTitles:   AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles:  AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles:    AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: [FlSpot(0, capital),
                    FlSpot((curve.length - 1).toDouble(), capital)],
            isCurved: false,
            color: AppColors.border,
            barWidth: 1,
            dotData: const FlDotData(show: false),
            dashArray: [4, 4],
          ),
          LineChartBarData(
            spots: spots,
            isCurved: true,
            curveSmoothness: 0.3,
            color: profitColor,
            barWidth: 2.5,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                begin: Alignment.topCenter, end: Alignment.bottomCenter,
                colors: [profitColor.withValues(alpha: 0.2),
                         profitColor.withValues(alpha: 0.0)],
              ),
            ),
          ),
        ],
        lineTouchData: const LineTouchData(enabled: false),
      )),
    );
  }
}

// ── Small widgets ─────────────────────────────────────────────────────────────

class _ClassBadge extends StatelessWidget {
  final String cls;
  const _ClassBadge({required this.cls});

  Color get _color {
    switch (cls) {
      case 'commodity': return const Color(0xFFF59E0B);
      case 'forex':     return const Color(0xFF6366F1);
      default:          return AppColors.primary;
    }
  }

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(
      color: _color.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(cls.toUpperCase(),
        style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: _color)),
  );
}

class _LevelTile extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _LevelTile({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label,
          style: const TextStyle(fontSize: 9, color: AppColors.textMuted)),
      const SizedBox(height: 2),
      Text(value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
          color: color)),
    ],
  ));
}

class _MacroChip extends StatelessWidget {
  final String label;
  final Color  color;
  const _MacroChip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600,
        color: color)),
  );
}

class _PickChip extends StatelessWidget {
  final TopPick pick;
  const _PickChip({required this.pick});

  @override
  Widget build(BuildContext context) {
    final color = pick.action == 'BUY'  ? AppColors.buy
                : pick.action == 'SELL' ? AppColors.sell
                : AppColors.hold;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(pick.displayName,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
                color: AppColors.textPrimary)),
        const SizedBox(width: 5),
        Text(pick.action,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: color)),
        const SizedBox(width: 4),
        Text('${pick.confidence}%',
            style: TextStyle(fontSize: 9, color: color)),
      ]),
    );
  }
}

// ── Loading / Error helpers ───────────────────────────────────────────────────

class _LoadingCard extends StatelessWidget {
  final double height;
  const _LoadingCard({required this.height});

  @override
  Widget build(BuildContext context) => Container(
    height: height,
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.border),
    ),
    child: const Center(child: CircularProgressIndicator(
        color: AppColors.primary, strokeWidth: 2)),
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
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.sell.withValues(alpha: 0.3)),
    ),
    child: Column(children: [
      const Icon(Icons.wifi_off, size: 36, color: AppColors.textMuted),
      const SizedBox(height: 10),
      Text(message, textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
      const SizedBox(height: 14),
      TextButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh, size: 16),
        label: const Text('Retry'),
      ),
    ]),
  );
}
