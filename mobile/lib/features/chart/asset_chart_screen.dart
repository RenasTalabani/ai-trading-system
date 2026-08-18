import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/providers/chart_provider.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/providers/watchlist_provider.dart';
import '../../core/theme/app_theme.dart';

class AssetChartScreen extends ConsumerStatefulWidget {
  final String asset;
  final String? signal;
  final int? signalConf;
  const AssetChartScreen(
      {super.key, required this.asset, this.signal, this.signalConf});

  @override
  ConsumerState<AssetChartScreen> createState() => _AssetChartScreenState();
}

class _AssetChartScreenState extends ConsumerState<AssetChartScreen> {
  String _tf = '1H';
  int? _touched;

  String get _interval =>
      switch (_tf) { '4H' => '4h', '1D' => '1d', _ => '1h' };
  int get _limit => switch (_tf) { '4H' => 42, '1D' => 60, _ => 48 };

  @override
  Widget build(BuildContext context) {
    final query =
        ChartQuery(asset: widget.asset, interval: _interval, limit: _limit);
    final chartAsync = ref.watch(chartProvider(query));
    final brainAsync = ref.watch(brainActionProvider);

    ActionReport? report;
    brainAsync.whenData((r) {
      if (r.bestAsset == widget.asset) report = r;
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios,
              size: 18, color: AppColors.textSecondary),
          onPressed: () => Navigator.pop(context),
        ),
        title: Row(children: [
          _AssetDot(asset: widget.asset, size: 28),
          const SizedBox(width: 8),
          Text(displayNameFor(widget.asset),
              style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          if (widget.signal != null) ...[
            const SizedBox(width: 8),
            _SignalPill(action: widget.signal!),
          ],
        ]),
      ),
      body: chartAsync.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: AppColors.primary)),
        error: (_, __) => const Center(
            child: Text('Chart unavailable',
                style: TextStyle(color: AppColors.textMuted))),
        data: (candles) {
          if (candles.length < 2) {
            return const Center(
                child: Text('Not enough data',
                    style: TextStyle(color: AppColors.textMuted)));
          }

          final tc = (_touched != null && _touched! < candles.length)
              ? candles[_touched!]
              : null;
          final last = candles.last;
          final pctChange =
              (last.close - candles.first.close) / candles.first.close * 100;
          final isUp = pctChange >= 0;
          final lineColor = isUp ? AppColors.buy : AppColors.sell;

          final hasEma20 = candles.any((c) => c.ema20 != null);
          final hasEma50 = candles.any((c) => c.ema50 != null);
          final hasRsi = candles.any((c) => c.rsi != null);
          final lastRsi =
              candles.lastWhere((c) => c.rsi != null, orElse: () => last).rsi;

          return Column(children: [
            // ── Price header ──────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
              child:
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                      Text(_fmtPrice(tc?.close ?? last.close),
                          style: const TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.w900,
                              color: AppColors.textPrimary)),
                      const SizedBox(height: 2),
                      Text(
                        tc != null
                            ? DateFormat('MMM d  HH:mm').format(tc.timestamp)
                            : '${candles.length} candles · $_tf',
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.textMuted),
                      ),
                    ])),
                _ChangePill(pct: pctChange),
              ]),
            ),

            // ── Indicator legend ──────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
              child: Row(children: [
                _LegendDot(color: lineColor, label: 'Price'),
                if (hasEma20) ...[
                  const SizedBox(width: 10),
                  const _LegendDot(
                      color: Color(0xFFF7931A), label: 'EMA20', dashed: true),
                ],
                if (hasEma50) ...[
                  const SizedBox(width: 10),
                  const _LegendDot(
                      color: Color(0xFF9945FF), label: 'EMA50', dashed: true),
                ],
                const Spacer(),
                // Time selector right-aligned
                _TimeSelector(
                  current: _tf,
                  onChanged: (v) => setState(() {
                    _tf = v;
                    _touched = null;
                  }),
                ),
              ]),
            ),

            // ── Price + EMA chart ─────────────────────────────────────
            Expanded(
              flex: 55,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: _PriceChart(
                  candles: candles,
                  touched: _touched,
                  onTouch: (i) => setState(() => _touched = i),
                ),
              ),
            ),

            // ── Volume bars ───────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 2, 8, 0),
              child: SizedBox(
                height: 46,
                child: _VolumeChart(candles: candles, touched: _touched),
              ),
            ),

            // ── RSI ───────────────────────────────────────────────────
            if (hasRsi) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
                child: Row(children: [
                  const Text('RSI',
                      style: TextStyle(
                          fontSize: 9,
                          color: AppColors.textMuted,
                          letterSpacing: 1)),
                  const SizedBox(width: 4),
                  if (lastRsi != null)
                    Text(lastRsi.toStringAsFixed(0),
                        style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            color: lastRsi > 70
                                ? AppColors.sell
                                : lastRsi < 30
                                    ? AppColors.buy
                                    : AppColors.textMuted)),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 0),
                child: SizedBox(
                  height: 44,
                  child: _RsiChart(candles: candles, touched: _touched),
                ),
              ),
            ],

            // ── AI signal card ────────────────────────────────────────
            if (report != null || widget.signal != null)
              _SignalCard(
                report: report,
                signal: widget.signal,
                conf: widget.signalConf,
              ),

            const SizedBox(height: 20),
          ]);
        },
      ),
    );
  }
}

// ── Price Chart ───────────────────────────────────────────────────────────────

class _PriceChart extends StatelessWidget {
  final List<CandleData> candles;
  final int? touched;
  final ValueChanged<int?> onTouch;
  const _PriceChart(
      {required this.candles, required this.touched, required this.onTouch});

  @override
  Widget build(BuildContext context) {
    final closes = candles.map((c) => c.close).toList();
    final isUp = closes.last >= closes.first;
    final lineColor = isUp ? AppColors.buy : AppColors.sell;

    final minY = closes.reduce((a, b) => a < b ? a : b);
    final maxY = closes.reduce((a, b) => a > b ? a : b);
    final pad = (maxY - minY) * 0.12;

    final spots = candles
        .asMap()
        .entries
        .map((e) => FlSpot(e.key.toDouble(), e.value.close))
        .toList();

    final ema20Spots = candles
        .asMap()
        .entries
        .where((e) => e.value.ema20 != null)
        .map((e) => FlSpot(e.key.toDouble(), e.value.ema20!))
        .toList();

    final ema50Spots = candles
        .asMap()
        .entries
        .where((e) => e.value.ema50 != null)
        .map((e) => FlSpot(e.key.toDouble(), e.value.ema50!))
        .toList();

    return LineChart(
      LineChartData(
        minX: 0,
        maxX: (candles.length - 1).toDouble(),
        minY: minY - pad,
        maxY: maxY + pad,
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: (maxY - minY + pad * 2) / 4,
          getDrawingHorizontalLine: (_) => FlLine(
              color: AppColors.border.withValues(alpha: 0.35),
              strokeWidth: 0.5),
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          show: true,
          leftTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 52,
              getTitlesWidget: (v, _) => Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Text(_fmtPriceShort(v),
                    style: const TextStyle(
                        fontSize: 9, color: AppColors.textMuted)),
              ),
            ),
          ),
        ),
        lineTouchData: LineTouchData(
          enabled: true,
          touchCallback: (event, response) {
            if (event is FlLongPressEnd || event is FlPanEndEvent) {
              onTouch(null);
            } else if (response?.lineBarSpots?.isNotEmpty == true) {
              onTouch(response!.lineBarSpots![0].spotIndex);
            }
          },
          getTouchedSpotIndicator: (_, spotIndexes) => spotIndexes
              .map((_) => TouchedSpotIndicatorData(
                    FlLine(
                        color: AppColors.textMuted.withValues(alpha: 0.5),
                        strokeWidth: 1),
                    const FlDotData(show: false),
                  ))
              .toList(),
          touchTooltipData: LineTouchTooltipData(
            getTooltipColor: (_) => AppColors.card,
            getTooltipItems: (spots) => spots.asMap().entries.map((e) {
              if (e.key != 0) return null;
              final i = e.value.spotIndex;
              if (i >= candles.length) return null;
              final c = candles[i];
              return LineTooltipItem(
                _fmtPrice(c.close),
                const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w700),
                children: [
                  TextSpan(
                    text: '\n${DateFormat("MMM d  HH:mm").format(c.timestamp)}',
                    style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10,
                        fontWeight: FontWeight.normal),
                  ),
                ],
              );
            }).toList(),
          ),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            curveSmoothness: 0.15,
            color: lineColor,
            barWidth: 2,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                colors: [
                  lineColor.withValues(alpha: 0.18),
                  lineColor.withValues(alpha: 0)
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
          if (ema20Spots.isNotEmpty)
            LineChartBarData(
              spots: ema20Spots,
              isCurved: true,
              color: const Color(0xFFF7931A).withValues(alpha: 0.7),
              barWidth: 1,
              dashArray: [4, 3],
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(show: false),
            ),
          if (ema50Spots.isNotEmpty)
            LineChartBarData(
              spots: ema50Spots,
              isCurved: true,
              color: const Color(0xFF9945FF).withValues(alpha: 0.7),
              barWidth: 1,
              dashArray: [4, 3],
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(show: false),
            ),
        ],
      ),
    );
  }
}

// ── Volume Chart ──────────────────────────────────────────────────────────────

class _VolumeChart extends StatelessWidget {
  final List<CandleData> candles;
  final int? touched;
  const _VolumeChart({required this.candles, this.touched});

  @override
  Widget build(BuildContext context) {
    final maxVol = candles.map((c) => c.volume).reduce((a, b) => a > b ? a : b);
    if (maxVol == 0) return const SizedBox.shrink();

    final groups = candles.asMap().entries.map((e) {
      final c = e.value;
      final isUp = c.close >= c.open;
      final col = (isUp ? AppColors.buy : AppColors.sell)
          .withValues(alpha: touched == e.key ? 0.85 : 0.35);
      return BarChartGroupData(
        x: e.key,
        barRods: [
          BarChartRodData(
              toY: c.volume,
              color: col,
              width: 2,
              borderRadius: BorderRadius.circular(1))
        ],
      );
    }).toList();

    return BarChart(BarChartData(
      alignment: BarChartAlignment.spaceAround,
      maxY: maxVol * 1.2,
      barGroups: groups,
      gridData: const FlGridData(show: false),
      borderData: FlBorderData(show: false),
      titlesData: const FlTitlesData(show: false),
      barTouchData: BarTouchData(enabled: false),
    ));
  }
}

// ── RSI Chart ─────────────────────────────────────────────────────────────────

class _RsiChart extends StatelessWidget {
  final List<CandleData> candles;
  final int? touched;
  const _RsiChart({required this.candles, this.touched});

  @override
  Widget build(BuildContext context) {
    final spots = candles
        .asMap()
        .entries
        .where((e) => e.value.rsi != null)
        .map((e) => FlSpot(e.key.toDouble(), e.value.rsi!))
        .toList();
    if (spots.length < 2) return const SizedBox.shrink();

    return LineChart(LineChartData(
      minX: 0,
      maxX: (candles.length - 1).toDouble(),
      minY: 0,
      maxY: 100,
      gridData: FlGridData(
        show: true,
        drawVerticalLine: false,
        horizontalInterval: 30,
        checkToShowHorizontalLine: (v) => v == 30 || v == 70,
        getDrawingHorizontalLine: (v) => FlLine(
          color: (v == 70 ? AppColors.sell : AppColors.buy)
              .withValues(alpha: 0.25),
          strokeWidth: 0.8,
          dashArray: [4, 4],
        ),
      ),
      borderData: FlBorderData(show: false),
      titlesData: FlTitlesData(
        show: true,
        leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        bottomTitles:
            const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        rightTitles: AxisTitles(
          sideTitles: SideTitles(
            showTitles: true,
            reservedSize: 28,
            getTitlesWidget: (v, _) => (v == 30 || v == 70)
                ? Text('${v.toInt()}',
                    style: const TextStyle(
                        fontSize: 8, color: AppColors.textMuted))
                : const SizedBox.shrink(),
          ),
        ),
      ),
      lineTouchData: const LineTouchData(enabled: false),
      lineBarsData: [
        LineChartBarData(
          spots: spots,
          isCurved: true,
          curveSmoothness: 0.2,
          color: const Color(0xFFF3BA2F),
          barWidth: 1.5,
          dotData: const FlDotData(show: false),
          belowBarData: BarAreaData(show: false),
        ),
      ],
    ));
  }
}

// ── Signal Card ───────────────────────────────────────────────────────────────

class _SignalCard extends StatelessWidget {
  final ActionReport? report;
  final String? signal;
  final int? conf;
  const _SignalCard({this.report, this.signal, this.conf});

  @override
  Widget build(BuildContext context) {
    final action = report?.action ?? signal ?? 'HOLD';
    final pct = report?.confidence ?? conf ?? 0;
    final color = action == 'BUY'
        ? AppColors.buy
        : action == 'SELL'
            ? AppColors.sell
            : AppColors.hold;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: color.withValues(alpha: 0.4)),
            ),
            child: Text(action,
                style: TextStyle(
                    color: color, fontSize: 14, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Row(children: [
                  const Text('AI Confidence',
                      style:
                          TextStyle(color: AppColors.textMuted, fontSize: 11)),
                  const Spacer(),
                  Text('$pct%',
                      style: TextStyle(
                          color: color,
                          fontSize: 11,
                          fontWeight: FontWeight.w700)),
                ]),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(
                    value: pct / 100,
                    minHeight: 4,
                    backgroundColor: AppColors.border,
                    valueColor: AlwaysStoppedAnimation(color),
                  ),
                ),
              ])),
        ]),
        if (report?.entryPrice != null ||
            report?.stopLoss != null ||
            report?.takeProfit != null) ...[
          const SizedBox(height: 10),
          const Divider(color: AppColors.border, height: 1),
          const SizedBox(height: 10),
          Row(children: [
            if (report!.entryPrice != null)
              Expanded(
                  child:
                      _Level('Entry', report!.entryPrice!, AppColors.primary)),
            if (report!.stopLoss != null)
              Expanded(
                  child: _Level('Stop', report!.stopLoss!, AppColors.sell)),
            if (report!.takeProfit != null)
              Expanded(
                  child: _Level('Target', report!.takeProfit!, AppColors.buy)),
          ]),
        ],
      ]),
    );
  }
}

class _Level extends StatelessWidget {
  final String label;
  final double value;
  final Color color;
  const _Level(this.label, this.value, this.color);
  @override
  Widget build(BuildContext context) => Column(children: [
        Text(label,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 10)),
        const SizedBox(height: 3),
        Text(_fmtPrice(value),
            style: TextStyle(
                color: color, fontSize: 12, fontWeight: FontWeight.w700)),
      ]);
}

// ── Supporting widgets ────────────────────────────────────────────────────────

class _AssetDot extends StatelessWidget {
  final String asset;
  final double size;
  const _AssetDot({required this.asset, required this.size});

  static const _colors = [
    Color(0xFFF7931A),
    Color(0xFF627EEA),
    Color(0xFFF3BA2F),
    Color(0xFF9945FF),
    Color(0xFF00AAE4),
    Color(0xFF0033AD),
    Color(0xFFBA9F33),
    Color(0xFFE84142),
    Color(0xFF2A5ADA),
    Color(0xFF8247E5),
  ];

  @override
  Widget build(BuildContext context) {
    final sym = symbolFor(asset);
    final color =
        _colors[sym.codeUnits.fold(0, (a, b) => a + b) % _colors.length];
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withValues(alpha: 0.15),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Center(
          child: Text(
        sym.length > 3 ? sym.substring(0, 3) : sym,
        style: TextStyle(
            color: color, fontSize: size * 0.3, fontWeight: FontWeight.w800),
      )),
    );
  }
}

class _SignalPill extends StatelessWidget {
  final String action;
  const _SignalPill({required this.action});
  @override
  Widget build(BuildContext context) {
    final color = action == 'BUY'
        ? AppColors.buy
        : action == 'SELL'
            ? AppColors.sell
            : AppColors.hold;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(action,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w800)),
    );
  }
}

class _ChangePill extends StatelessWidget {
  final double pct;
  const _ChangePill({required this.pct});
  @override
  Widget build(BuildContext context) {
    final up = pct >= 0;
    final color = up ? AppColors.buy : AppColors.sell;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text('${up ? '+' : ''}${pct.toStringAsFixed(2)}%',
          style: TextStyle(
              color: color, fontSize: 13, fontWeight: FontWeight.w700)),
    );
  }
}

class _TimeSelector extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;
  const _TimeSelector({required this.current, required this.onChanged});
  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: ['1H', '4H', '1D'].map((tf) {
          final sel = tf == current;
          return GestureDetector(
            onTap: () => onChanged(tf),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              margin: const EdgeInsets.only(left: 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: sel
                    ? AppColors.primary.withValues(alpha: 0.15)
                    : AppColors.surface,
                borderRadius: BorderRadius.circular(7),
                border: Border.all(
                    color: sel ? AppColors.primary : AppColors.border),
              ),
              child: Text(tf,
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: sel ? FontWeight.w700 : FontWeight.normal,
                      color:
                          sel ? AppColors.primary : AppColors.textSecondary)),
            ),
          );
        }).toList(),
      );
}

class _LegendDot extends StatelessWidget {
  final Color color;
  final String label;
  final bool dashed;
  const _LegendDot(
      {required this.color, required this.label, this.dashed = false});
  @override
  Widget build(BuildContext context) =>
      Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
            width: 14,
            height: 2,
            decoration: BoxDecoration(
              color: dashed ? Colors.transparent : color,
              border: dashed ? Border.all(color: color, width: 1) : null,
              borderRadius: BorderRadius.circular(1),
            )),
        const SizedBox(width: 4),
        Text(label,
            style: TextStyle(fontSize: 9, color: color, letterSpacing: 0.3)),
      ]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

String _fmtPrice(double v) {
  if (v >= 1000) return '\$${NumberFormat('#,##0.00').format(v)}';
  if (v >= 1) return '\$${v.toStringAsFixed(2)}';
  if (v >= 0.01) return '\$${v.toStringAsFixed(4)}';
  return '\$${v.toStringAsFixed(6)}';
}

String _fmtPriceShort(double v) {
  if (v >= 1e6) return '\$${(v / 1e6).toStringAsFixed(1)}M';
  if (v >= 1e3) return '\$${(v / 1e3).toStringAsFixed(0)}k';
  if (v >= 1) return '\$${v.toStringAsFixed(0)}';
  return '\$${v.toStringAsFixed(3)}';
}
