import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/virtual_portfolio_model.dart';
import '../../core/providers/virtual_portfolio_provider.dart';

class VirtualPerformanceScreen extends ConsumerWidget {
  const VirtualPerformanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final perfAsync = ref.watch(virtualPerformanceProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Performance'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(virtualPerformanceProvider.notifier).refresh(),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Set capital',
            onPressed: () => _showCapitalDialog(context, ref, perfAsync.valueOrNull),
          ),
        ],
      ),
      body: perfAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error:   (e, _) => _ErrorView(error: e.toString(), onRetry: () =>
            ref.read(virtualPerformanceProvider.notifier).refresh()),
        data:    (perf) => _PerformanceBody(perf: perf),
      ),
    );
  }

  void _showCapitalDialog(BuildContext context, WidgetRef ref,
      VirtualPerformanceModel? perf) {
    final balCtrl  = TextEditingController(
        text: perf?.startingBalance.toStringAsFixed(0) ?? '500');
    final riskCtrl = TextEditingController(
        text: perf?.riskPerTradePct.toStringAsFixed(0) ?? '5');

    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.card,
        title: const Text('Capital Settings',
            style: TextStyle(color: AppColors.textPrimary)),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          _DialogField(ctrl: balCtrl,  label: 'Starting Balance (USD)'),
          const SizedBox(height: 12),
          _DialogField(ctrl: riskCtrl, label: 'Risk per Trade (%)'),
        ]),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            onPressed: () {
              Navigator.pop(context);
              _confirmReset(context, ref,
                  double.tryParse(balCtrl.text)  ?? 500,
                  double.tryParse(riskCtrl.text) ?? 5);
            },
            child: const Text('Reset Portfolio'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.primary),
            onPressed: () {
              Navigator.pop(context);
              ref.read(virtualPerformanceProvider.notifier).setCapital(
                balance: double.tryParse(balCtrl.text),
                riskPct: double.tryParse(riskCtrl.text),
              );
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _confirmReset(BuildContext context, WidgetRef ref,
      double balance, double risk) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.card,
        title: const Text('Reset Portfolio',
            style: TextStyle(color: AppColors.textPrimary)),
        content: Text(
          'This will delete all virtual trades and restart with \$${balance.toStringAsFixed(0)}.',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () {
              Navigator.pop(context);
              ref.read(virtualPerformanceProvider.notifier)
                  .reset(balance: balance, riskPct: risk);
              ref.read(virtualTradesProvider.notifier).fetch();
            },
            child: const Text('Reset'),
          ),
        ],
      ),
    );
  }
}

// ─── Range selector ───────────────────────────────────────────────────────────

class _RangeSelector extends ConsumerWidget {
  const _RangeSelector();

  static const _options = [('7D', '7d'), ('30D', '30d'), ('All Time', 'all')];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(performanceRangeProvider);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: _options.map((opt) {
          final selected = current == opt.$2;
          return Expanded(
            child: GestureDetector(
              onTap: () => ref.read(performanceRangeProvider.notifier).state = opt.$2,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                padding: const EdgeInsets.symmetric(vertical: 7),
                decoration: BoxDecoration(
                  color: selected ? AppColors.primary : Colors.transparent,
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(opt.$1,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                    color: selected ? Colors.white : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ─── Main body ────────────────────────────────────────────────────────────────

class _PerformanceBody extends StatelessWidget {
  final VirtualPerformanceModel perf;
  const _PerformanceBody({required this.perf});

  @override
  Widget build(BuildContext context) {
    final usd = NumberFormat.currency(symbol: '\$', decimalDigits: 2);

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async {
        final ref = ProviderScope.containerOf(context);
        await ref.read(virtualPerformanceProvider.notifier).refresh();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Range selector ────────────────────────────────────────────────
          const _RangeSelector(),
          const SizedBox(height: 12),

          // ── Header: balance card ──────────────────────────────────────────
          _BalanceCard(perf: perf, usd: usd),
          const SizedBox(height: 12),

          // ── Stat chips row 1 ──────────────────────────────────────────────
          Row(children: [
            Expanded(child: _StatChip(
              label: 'Total Trades', value: '${perf.totalTrades}',
              icon: Icons.swap_horiz)),
            const SizedBox(width: 8),
            Expanded(child: _StatChip(
              label: 'Open', value: '${perf.openTrades}',
              icon: Icons.timer_outlined,
              valueColor: AppColors.hold)),
          ]),
          const SizedBox(height: 8),

          // ── Stat chips row 2 ──────────────────────────────────────────────
          Row(children: [
            Expanded(child: _StatChip(
              label: 'Win Rate', value: '${perf.winRate.toStringAsFixed(1)}%',
              icon: Icons.emoji_events_outlined,
              valueColor: perf.winRate >= 50 ? AppColors.buy : AppColors.sell)),
            const SizedBox(width: 8),
            Expanded(child: _StatChip(
              label: 'Risk/Trade',
              value: '${perf.riskPerTradePct.toStringAsFixed(0)}%',
              icon: Icons.shield_outlined)),
          ]),
          const SizedBox(height: 8),

          // ── Stat chips row 3 — drawdown + avg duration ────────────────────
          Row(children: [
            Expanded(child: _StatChip(
              label: 'Max Drawdown',
              value: '-${perf.maxDrawdown.toStringAsFixed(1)}%',
              icon: Icons.trending_down,
              valueColor: perf.maxDrawdown > 10 ? AppColors.sell : AppColors.textPrimary)),
            const SizedBox(width: 8),
            Expanded(child: _StatChip(
              label: 'Avg Duration',
              value: _formatDuration(perf.avgDurationMinutes),
              icon: Icons.hourglass_bottom_outlined)),
          ]),
          const SizedBox(height: 12),

          // ── Win / Loss breakdown ──────────────────────────────────────────
          _WinLossBar(perf: perf, usd: usd),
          const SizedBox(height: 12),

          // ── Best & worst trade ────────────────────────────────────────────
          if (perf.bestTrade != null || perf.worstTrade != null) ...[
            _BestWorstSection(perf: perf, usd: usd),
            const SizedBox(height: 12),
          ],

          // ── Balance chart ─────────────────────────────────────────────────
          if (perf.balanceHistory.length >= 2) ...[
            _BalanceChart(history: perf.balanceHistory,
                starting: perf.startingBalance),
            const SizedBox(height: 12),
          ],

          // ── View trades button ────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.textPrimary,
                side: const BorderSide(color: AppColors.border),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              icon: const Icon(Icons.list_alt),
              label: const Text('Trade History'),
              onPressed: () => context.push('/performance/trades'),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  String _formatDuration(int minutes) {
    if (minutes == 0) return '—';
    if (minutes < 60)  return '${minutes}m';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '${h}h' : '${h}h ${m}m';
  }
}

// ─── Best / Worst trade section ───────────────────────────────────────────────

class _BestWorstSection extends StatelessWidget {
  final VirtualPerformanceModel perf;
  final NumberFormat usd;
  const _BestWorstSection({required this.perf, required this.usd});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      if (perf.bestTrade != null)
        Expanded(child: _TradeHighlight(
          label: 'Best Trade',
          snapshot: perf.bestTrade!,
          color: AppColors.buy,
          usd: usd,
        )),
      if (perf.bestTrade != null && perf.worstTrade != null)
        const SizedBox(width: 8),
      if (perf.worstTrade != null)
        Expanded(child: _TradeHighlight(
          label: 'Worst Trade',
          snapshot: perf.worstTrade!,
          color: AppColors.sell,
          usd: usd,
        )),
    ]);
  }
}

class _TradeHighlight extends StatelessWidget {
  final String label;
  final TradeSnapshot snapshot;
  final Color color;
  final NumberFormat usd;
  const _TradeHighlight({
    required this.label, required this.snapshot,
    required this.color, required this.usd,
  });

  @override
  Widget build(BuildContext context) {
    final sign = snapshot.pnl >= 0 ? '+' : '';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withAlpha(20),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withAlpha(60)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
        const SizedBox(height: 4),
        Text(
          '$sign${usd.format(snapshot.pnl.abs())}',
          style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16),
        ),
        const SizedBox(height: 2),
        Text(
          '${snapshot.asset.replaceAll('USDT', '')} ${snapshot.direction}',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
      ]),
    );
  }
}

// ─── Balance card ─────────────────────────────────────────────────────────────

class _BalanceCard extends StatelessWidget {
  final VirtualPerformanceModel perf;
  final NumberFormat usd;
  const _BalanceCard({required this.perf, required this.usd});

  @override
  Widget build(BuildContext context) {
    final isProfit = perf.isProfitable;
    final pnlColor = isProfit ? AppColors.buy : AppColors.sell;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Virtual Balance',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          if (perf.peakBalance > perf.startingBalance)
            Text('Peak: ${usd.format(perf.peakBalance)}',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
        ]),
        const SizedBox(height: 6),
        Text(usd.format(perf.currentBalance),
            style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 32,
                fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Row(children: [
          Icon(isProfit ? Icons.arrow_upward : Icons.arrow_downward,
              size: 16, color: pnlColor),
          const SizedBox(width: 4),
          Text(
            '${isProfit ? '+' : ''}${usd.format(perf.netProfit)} '
            '(${perf.netProfitPct.toStringAsFixed(2)}%)',
            style: TextStyle(color: pnlColor, fontWeight: FontWeight.w600),
          ),
          const SizedBox(width: 8),
          const Text('vs starting',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
        ]),
      ]),
    );
  }
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? valueColor;
  const _StatChip(
      {required this.label, required this.value, required this.icon,
        this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: [
        Icon(icon, size: 18, color: AppColors.textMuted),
        const SizedBox(width: 8),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          Text(value,
              style: TextStyle(
                  color: valueColor ?? AppColors.textPrimary,
                  fontWeight: FontWeight.bold,
                  fontSize: 16)),
        ]),
      ]),
    );
  }
}

// ─── Win / Loss bar ───────────────────────────────────────────────────────────

class _WinLossBar extends StatelessWidget {
  final VirtualPerformanceModel perf;
  final NumberFormat usd;
  const _WinLossBar({required this.perf, required this.usd});

  @override
  Widget build(BuildContext context) {
    final total = perf.winCount + perf.lossCount;
    final winFrac = total > 0 ? perf.winCount / total : 0.0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          _PnlLabel(label: 'Wins',    value: usd.format(perf.totalProfit),
              count: perf.winCount,   color: AppColors.buy),
          _PnlLabel(label: 'Losses',  value: '-${usd.format(perf.totalLoss)}',
              count: perf.lossCount,  color: AppColors.sell,
              align: CrossAxisAlignment.end),
        ]),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Row(children: [
            Expanded(
              flex: (winFrac * 100).round().clamp(0, 100),
              child: Container(height: 8, color: AppColors.buy),
            ),
            Expanded(
              flex: 100 - (winFrac * 100).round().clamp(0, 100),
              child: Container(height: 8, color: AppColors.sell),
            ),
          ]),
        ),
      ]),
    );
  }
}

class _PnlLabel extends StatelessWidget {
  final String label, value;
  final int count;
  final Color color;
  final CrossAxisAlignment align;
  const _PnlLabel(
      {required this.label, required this.value, required this.count,
        required this.color, this.align = CrossAxisAlignment.start});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: align,
    children: [
      Text('$count $label',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
      Text(value,
          style: TextStyle(color: color,
              fontWeight: FontWeight.bold, fontSize: 15)),
    ],
  );
}

// ─── Balance chart (custom paint) ─────────────────────────────────────────────

class _BalanceChart extends StatelessWidget {
  final List<BalancePoint> history;
  final double starting;
  const _BalanceChart({required this.history, required this.starting});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Balance History',
            style: TextStyle(color: AppColors.textSecondary,
                fontSize: 13, fontWeight: FontWeight.w500)),
        const SizedBox(height: 12),
        SizedBox(
          height: 120,
          child: CustomPaint(
            size: Size.infinite,
            painter: _LinePainter(history: history, starting: starting),
          ),
        ),
      ]),
    );
  }
}

class _LinePainter extends CustomPainter {
  final List<BalancePoint> history;
  final double starting;
  const _LinePainter({required this.history, required this.starting});

  @override
  void paint(Canvas canvas, Size size) {
    if (history.length < 2) return;

    final values = history.map((p) => p.balance).toList();
    final minV   = values.reduce(math.min);
    final maxV   = values.reduce(math.max);
    final range  = (maxV - minV).abs();
    final pad    = range == 0 ? 1.0 : range * 0.1;

    double toY(double v) =>
        size.height - ((v - (minV - pad)) / (range + 2 * pad)) * size.height;
    double toX(int i) => (i / (history.length - 1)) * size.width;

    final baseY = toY(starting);
    canvas.drawLine(
      Offset(0, baseY), Offset(size.width, baseY),
      Paint()
        ..color = AppColors.border
        ..strokeWidth = 1
        ..style = PaintingStyle.stroke,
    );

    final path = Path();
    path.moveTo(toX(0), toY(values[0]));
    for (int i = 1; i < values.length; i++) {
      path.lineTo(toX(i), toY(values[i]));
    }
    final fillPath = Path.from(path)
      ..lineTo(toX(values.length - 1), size.height)
      ..lineTo(0, size.height)
      ..close();

    final isProfit = values.last >= starting;
    final lineColor = isProfit ? AppColors.buy : AppColors.sell;

    canvas.drawPath(fillPath, Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter, end: Alignment.bottomCenter,
        colors: [lineColor.withAlpha(60), lineColor.withAlpha(5)],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height)));

    canvas.drawPath(path, Paint()
      ..color = lineColor
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round);

    final lastX = toX(values.length - 1);
    final lastY = toY(values.last);
    canvas.drawCircle(
        Offset(lastX, lastY), 4, Paint()..color = lineColor);
    canvas.drawCircle(
        Offset(lastX, lastY), 4,
        Paint()..color = AppColors.card..style = PaintingStyle.stroke..strokeWidth = 2);
  }

  @override
  bool shouldRepaint(_LinePainter old) => old.history != history;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
          style: const TextStyle(color: AppColors.textSecondary),
          textAlign: TextAlign.center),
      const SizedBox(height: 16),
      ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
    ]),
  );
}

class _DialogField extends StatelessWidget {
  final TextEditingController ctrl;
  final String label;
  const _DialogField({required this.ctrl, required this.label});

  @override
  Widget build(BuildContext context) => TextField(
    controller: ctrl,
    keyboardType: TextInputType.number,
    style: const TextStyle(color: AppColors.textPrimary),
    decoration: InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: AppColors.textSecondary),
      enabledBorder: const OutlineInputBorder(
          borderSide: BorderSide(color: AppColors.border)),
      focusedBorder: const OutlineInputBorder(
          borderSide: BorderSide(color: AppColors.primary)),
    ),
  );
}
