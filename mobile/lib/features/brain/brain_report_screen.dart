import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/providers/price_alerts_provider.dart';
import 'my_trades_sheet.dart';
import 'risk_calculator_sheet.dart';

bool _isWarmingUp(Object e) {
  final s = e.toString().toLowerCase();
  return s.contains('503') || s.contains('service unavailable') ||
      s.contains('warming') || s.contains('starting');
}

class BrainReportScreen extends ConsumerStatefulWidget {
  const BrainReportScreen({super.key});

  @override
  ConsumerState<BrainReportScreen> createState() => _BrainReportScreenState();
}

class _BrainReportScreenState extends ConsumerState<BrainReportScreen> {
  Timer? _refreshTimer;
  Timer? _tickTimer;
  Timer? _priceTimer;

  @override
  void initState() {
    super.initState();
    _refreshTimer = Timer.periodic(const Duration(minutes: 30), (_) {
      if (!mounted) return;
      final balance = ref.read(brainBalanceProvider);
      ref.invalidate(brainActionProvider);
      ref.invalidate(brainPerformanceProvider(balance));
    });
    // Tick every minute to update the "next scan" countdown
    _tickTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
    // Refresh live price every 30 seconds
    _priceTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!mounted) return;
      final asset = ref.read(brainActionProvider).valueOrNull?.bestAsset ?? '';
      if (asset.isNotEmpty) ref.invalidate(livePriceProvider(asset));
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _tickTimer?.cancel();
    _priceTimer?.cancel();
    super.dispose();
  }

  String _nextScanLabel(ActionReport? r) {
    if (r == null) return '';
    final parts = <String>[];
    if (r.totalEvaluated > 0) parts.add('${r.totalEvaluated} assets');
    if (r.generatedAt != null) {
      final next = r.generatedAt!.add(const Duration(minutes: 30));
      final rem  = next.difference(DateTime.now());
      parts.add(rem.isNegative ? 'updating…' : 'next scan: ${rem.inMinutes}m');
    }
    return parts.join(' · ');
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
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('AI Brain',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                  if (actionAsync.valueOrNull != null)
                    Text(
                      _nextScanLabel(actionAsync.valueOrNull),
                      style: const TextStyle(fontSize: 10,
                          color: AppColors.textMuted),
                    ),
                ]),
                const Spacer(),
                Consumer(builder: (context, ref, _) {
                  final openCount = ref.watch(followsProvider
                      .select((s) => s.follows.where((f) => f.isOpen).length));
                  return IconButton(
                    icon: openCount > 0
                        ? Badge(
                            label: Text('$openCount'),
                            child: const Icon(Icons.add_chart_outlined, size: 20,
                                color: AppColors.textSecondary))
                        : const Icon(Icons.add_chart_outlined, size: 20,
                            color: AppColors.textSecondary),
                    onPressed: () => showMyTradesSheet(context),
                    tooltip: 'My Trades',
                  );
                }),
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
                  error:   (e, _) => _isWarmingUp(e)
                      ? _WarmingUpCard(onRetry: () => ref.invalidate(brainActionProvider))
                      : _ErrorCard(message: e.toString(),
                          onRetry: () => ref.invalidate(brainActionProvider)),
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

            // ── REPORT 3: MARKET PULSE ──────────────────────────────────
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 24, 16, 0),
                child: _SectionHeader(
                  label: 'REPORT 3',
                  title: 'Market Pulse',
                  icon: Icons.bar_chart,
                  color: AppColors.warning,
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                child: _MarketPulseCard(
                  actionReport: actionAsync.valueOrNull,
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

class _ActionReportCard extends ConsumerStatefulWidget {
  final ActionReport report;
  const _ActionReportCard({required this.report});

  @override
  ConsumerState<_ActionReportCard> createState() => _ActionReportCardState();
}

class _ActionReportCardState extends ConsumerState<_ActionReportCard> {
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
                const SizedBox(height: 4),
                Row(children: [
                  _ClassBadge(cls: r.assetClass),
                  const SizedBox(width: 6),
                  Text(r.timeframe,
                      style: const TextStyle(fontSize: 11,
                          color: AppColors.textSecondary)),
                  const SizedBox(width: 8),
                  _LivePriceBadge(asset: r.bestAsset),
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
          // Entry validity vs live price
          _EntryValidityRow(
            asset:      r.bestAsset,
            entryPrice: r.entryPrice,
            action:     r.action,
          ),
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

        // ── Follow This Trade + Risk Calculator ──────────────────────────
        const Divider(color: AppColors.border, height: 1),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
          child: Row(children: [
            Expanded(child: _FollowButton(report: widget.report)),
            const SizedBox(width: 10),
            GestureDetector(
              onTap: () => showRiskCalculatorSheet(
                context,
                entryPrice: widget.report.entryPrice,
                stopLoss:   widget.report.stopLoss,
                takeProfit: widget.report.takeProfit,
                asset:      widget.report.displayName,
              ),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.card,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Icon(Icons.calculate_outlined,
                    size: 20, color: AppColors.textSecondary),
              ),
            ),
          ]),
        ),

        if (r.generatedAt != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
            child: Text(
              'Updated ${_timeAgo(r.generatedAt!)}',
              style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
            ),
          ),
        ] else
          const SizedBox(height: 16),
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

// ── Follow This Trade button ──────────────────────────────────────────────────

class _FollowButton extends ConsumerStatefulWidget {
  final ActionReport report;
  const _FollowButton({required this.report});

  @override
  ConsumerState<_FollowButton> createState() => _FollowButtonState();
}

class _FollowButtonState extends ConsumerState<_FollowButton> {
  bool _loading = false;

  Future<void> _onTap() async {
    if (_loading) return;
    HapticFeedback.mediumImpact();
    setState(() => _loading = true);
    final r = widget.report;
    final isNew = await ref.read(followsProvider.notifier).followTrade({
      'asset':       r.bestAsset,
      'displayName': r.displayName,
      'action':      r.action,
      'entryPrice':  r.entryPrice,
      'stopLoss':    r.stopLoss,
      'takeProfit':  r.takeProfit,
      'confidence':  r.confidence,
      'timeframe':   r.timeframe,
    });
    if (mounted) {
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(isNew
            ? 'Following ${r.displayName} ${r.action}'
            : 'Already following ${r.displayName}'),
        backgroundColor: isNew ? AppColors.buy : AppColors.hold,
        duration: const Duration(seconds: 4),
        action: isNew && r.takeProfit != null
            ? SnackBarAction(
                label: 'Set TP Alert',
                textColor: Colors.white,
                onPressed: () async {
                  final tp        = r.takeProfit!;
                  final dir       = r.action == 'SELL' ? 'below' : 'above';
                  final messenger = ScaffoldMessenger.of(context);
                  final ok = await ref.read(priceAlertsProvider.notifier).create(
                    asset:        r.bestAsset,
                    displayName:  r.displayName,
                    targetPrice:  tp,
                    direction:    dir,
                    note:         'TP from AI Brain ${r.action}',
                  );
                  messenger.showSnackBar(SnackBar(
                    content: Text(ok
                        ? 'Alert set at \$${tp.toStringAsFixed(tp >= 100 ? 0 : 2)}'
                        : 'Could not set alert'),
                    backgroundColor: ok ? AppColors.primary : AppColors.sell,
                    duration: const Duration(seconds: 2),
                  ));
                },
              )
            : null,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final following = ref.watch(followsProvider
        .select((s) => s.follows.any(
            (f) => f.asset == widget.report.bestAsset && f.isOpen)));
    final c = widget.report.action == 'BUY'
        ? AppColors.buy
        : widget.report.action == 'SELL'
            ? AppColors.sell
            : AppColors.hold;

    if (following) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: c.withValues(alpha: 0.3)),
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.check_circle, size: 16, color: c),
          const SizedBox(width: 8),
          Text('Following ${widget.report.displayName}',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700,
                  color: c)),
        ]),
      );
    }

    return GestureDetector(
      onTap: _onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: c,
          borderRadius: BorderRadius.circular(12),
        ),
        child: _loading
            ? const Center(child: SizedBox(width: 16, height: 16,
                child: CircularProgressIndicator(
                    color: Colors.white, strokeWidth: 2)))
            : const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(Icons.add_chart, size: 16, color: Colors.white),
                SizedBox(width: 8),
                Text('Follow This Trade',
                    style: TextStyle(fontSize: 13,
                        fontWeight: FontWeight.w700, color: Colors.white)),
              ]),
      ),
    );
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
            onTap: () {
              HapticFeedback.selectionClick();
              ref.read(brainBalanceProvider.notifier).set(v.toDouble());
            },
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

class _EntryValidityRow extends ConsumerWidget {
  final String  asset;
  final double? entryPrice;
  final String  action;
  const _EntryValidityRow({
    required this.asset, required this.entryPrice, required this.action});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (entryPrice == null) return const SizedBox.shrink();
    final priceAsync = ref.watch(livePriceProvider(asset));
    final price = priceAsync.valueOrNull;
    if (price == null) return const SizedBox.shrink();

    final diff    = price - entryPrice!;
    final pct     = (diff / entryPrice!) * 100;
    final isBuy   = action == 'BUY';
    // For BUY: positive diff means price above entry (missed), negative = still below (good)
    // For SELL: negative diff means price below entry (missed), positive = still above (good)
    final missed  = isBuy ? pct > 2 : pct < -2;
    final optimal = isBuy ? pct < 0 : pct > 0;
    final color   = missed ? AppColors.warning : optimal ? AppColors.buy : AppColors.hold;
    final icon    = missed ? Icons.warning_amber_rounded
                 : optimal ? Icons.check_circle_outline
                 : Icons.radio_button_unchecked;
    final label   = missed
        ? 'Price ${isBuy ? "above" : "below"} entry by ${pct.abs().toStringAsFixed(1)}% — entry may be stale'
        : optimal
            ? 'Price ${isBuy ? "below" : "above"} entry — good entry zone'
            : 'Price near entry (${pct >= 0 ? '+' : ''}${pct.toStringAsFixed(1)}%)';

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
      child: Row(children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 6),
        Expanded(child: Text(label,
            style: TextStyle(fontSize: 11, color: color,
                fontWeight: FontWeight.w500))),
      ]),
    );
  }
}

class _LivePriceBadge extends ConsumerWidget {
  final String asset;
  const _LivePriceBadge({required this.asset});

  String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final priceAsync = ref.watch(livePriceProvider(asset));
    return priceAsync.when(
      loading: () => const SizedBox(
        width: 10, height: 10,
        child: CircularProgressIndicator(strokeWidth: 1.5,
            color: AppColors.textMuted),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (price) {
        if (price == null) return const SizedBox.shrink();
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(5),
            border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 5, height: 5,
              decoration: const BoxDecoration(
                  color: AppColors.buy, shape: BoxShape.circle),
            ),
            const SizedBox(width: 4),
            Text(_fmt(price),
                style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
                    color: AppColors.primary)),
          ]),
        );
      },
    );
  }
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

// ── Report 3: Market Pulse ────────────────────────────────────────────────────

class _MarketPulseCard extends ConsumerWidget {
  final ActionReport? actionReport;
  const _MarketPulseCard({this.actionReport});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final newsAsync = ref.watch(highImpactNewsProvider);
    final fg        = actionReport?.fearGreed;
    final sentiment = actionReport?.macroSentiment;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.3)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [

        // ── Fear & Greed + sentiment ─────────────────────────────────────
        Padding(
          padding: const EdgeInsets.all(20),
          child: Row(children: [
            if (fg != null) ...[
              _FearGreedGauge(value: fg),
              const SizedBox(width: 20),
            ],
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Market Sentiment',
                    style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                const SizedBox(height: 6),
                if (sentiment != null) ...[
                  _SentimentBadge(sentiment: sentiment),
                  const SizedBox(height: 8),
                ],
                if (fg != null)
                  Text(_fgLabel(fg),
                      style: const TextStyle(fontSize: 12,
                          color: AppColors.textSecondary, height: 1.4)),
              ],
            )),
          ]),
        ),

        // ── News headlines ───────────────────────────────────────────────
        const Divider(color: AppColors.border, height: 1),
        const Padding(
          padding: EdgeInsets.fromLTRB(20, 12, 20, 4),
          child: Row(children: [
            Icon(Icons.newspaper_outlined, size: 13,
                color: AppColors.textMuted),
            SizedBox(width: 6),
            Text('High-Impact News',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
          ]),
        ),
        newsAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: SizedBox(width: 16, height: 16,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.primary))),
          ),
          error: (_, __) => const Padding(
            padding: EdgeInsets.fromLTRB(20, 4, 20, 16),
            child: Text('News unavailable',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
          ),
          data: (items) => items.isEmpty
              ? const Padding(
                  padding: EdgeInsets.fromLTRB(20, 4, 20, 16),
                  child: Text('No high-impact news in the last 12h',
                      style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
                )
              : Column(children: [
                  ...items.take(4).map((n) => _NewsRow(item: n)),
                  const SizedBox(height: 4),
                ]),
        ),
      ]),
    );
  }

  String _fgLabel(int v) {
    if (v >= 75) return 'Extreme greed — market may be overheated';
    if (v >= 55) return 'Greed — risk-on sentiment dominant';
    if (v >= 45) return 'Neutral — market in equilibrium';
    if (v >= 25) return 'Fear — cautious sentiment, potential opportunity';
    return 'Extreme fear — capitulation possible';
  }
}

class _FearGreedGauge extends StatelessWidget {
  final int value;
  const _FearGreedGauge({required this.value});

  Color get _color {
    if (value >= 75) return AppColors.sell;
    if (value >= 55) return const Color(0xFFF59E0B);
    if (value >= 45) return AppColors.hold;
    if (value >= 25) return AppColors.primary;
    return AppColors.buy;
  }

  String get _label {
    if (value >= 75) return 'Extreme\nGreed';
    if (value >= 55) return 'Greed';
    if (value >= 45) return 'Neutral';
    if (value >= 25) return 'Fear';
    return 'Extreme\nFear';
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 72,
    child: Column(children: [
      Container(
        width: 72, height: 72,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: _color.withValues(alpha: 0.12),
          border: Border.all(color: _color, width: 3),
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('$value',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900,
                  color: _color)),
          const Text('/100',
              style: TextStyle(fontSize: 8, color: AppColors.textMuted)),
        ]),
      ),
      const SizedBox(height: 4),
      Text(_label,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700,
              color: _color)),
    ]),
  );
}

class _SentimentBadge extends StatelessWidget {
  final String sentiment;
  const _SentimentBadge({required this.sentiment});

  Color get _color {
    switch (sentiment.toLowerCase()) {
      case 'bullish': return AppColors.buy;
      case 'bearish': return AppColors.sell;
      default:        return AppColors.hold;
    }
  }

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: _color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: _color.withValues(alpha: 0.3)),
    ),
    child: Text(sentiment.toUpperCase(),
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800,
            color: _color)),
  );
}

class _NewsRow extends StatelessWidget {
  final NewsItem item;
  const _NewsRow({required this.item});

  Color get _sentimentColor {
    switch (item.sentiment.toLowerCase()) {
      case 'bullish': return AppColors.buy;
      case 'bearish': return AppColors.sell;
      default:        return AppColors.hold;
    }
  }

  String _timeAgo(DateTime dt) {
    final d = DateTime.now().difference(dt);
    if (d.inMinutes < 60) return '${d.inMinutes}m';
    if (d.inHours   < 24) return '${d.inHours}h';
    return '${d.inDays}d';
  }

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: item.url != null
        ? () => launchUrl(Uri.parse(item.url!),
              mode: LaunchMode.externalApplication)
        : null,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 3, height: 42,
          decoration: BoxDecoration(
            color: _sentimentColor,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
            children: [
          Text(item.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500,
                  color: AppColors.textPrimary, height: 1.4)),
          const SizedBox(height: 3),
          Row(children: [
            Text(item.source,
                style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
            const SizedBox(width: 8),
            Text(_timeAgo(item.publishedAt),
                style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: _sentimentColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(3),
              ),
              child: Text(item.sentiment.toUpperCase(),
                  style: TextStyle(fontSize: 8, fontWeight: FontWeight.w800,
                      color: _sentimentColor)),
            ),
            if (item.url != null) ...[
              const SizedBox(width: 6),
              const Icon(Icons.open_in_new, size: 10, color: AppColors.textMuted),
            ],
          ]),
        ])),
      ]),
    ),
  );
}

// ── Loading / Error helpers ───────────────────────────────────────────────────

class _WarmingUpCard extends StatefulWidget {
  final VoidCallback onRetry;
  const _WarmingUpCard({required this.onRetry});

  @override
  State<_WarmingUpCard> createState() => _WarmingUpCardState();
}

class _WarmingUpCardState extends State<_WarmingUpCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double>   _pulse;
  Timer? _retryTimer;
  int    _countdown = 30;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    _pulse = Tween<double>(begin: 0.5, end: 1.0)
        .animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut));
    _retryTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      setState(() => _countdown--);
      if (_countdown <= 0) { t.cancel(); widget.onRetry(); }
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _retryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(28),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.primary.withValues(alpha: 0.25)),
    ),
    child: Column(children: [
      AnimatedBuilder(
        animation: _pulse,
        builder: (_, __) => Opacity(
          opacity: _pulse.value,
          child: const Icon(Icons.psychology_outlined,
              size: 52, color: AppColors.primary),
        ),
      ),
      const SizedBox(height: 14),
      const Text('AI Brain is warming up',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700,
              color: AppColors.textPrimary)),
      const SizedBox(height: 6),
      const Text('The AI service is starting up.\nThis usually takes about 30 seconds.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.5)),
      const SizedBox(height: 18),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        const SizedBox(width: 14, height: 14,
            child: CircularProgressIndicator(
                strokeWidth: 2, color: AppColors.primary)),
        const SizedBox(width: 10),
        Text('Retrying in ${_countdown}s…',
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
      ]),
      const SizedBox(height: 12),
      TextButton(
        onPressed: () { _retryTimer?.cancel(); widget.onRetry(); },
        child: const Text('Retry now',
            style: TextStyle(color: AppColors.primary, fontSize: 12)),
      ),
    ]),
  );
}

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

  String get _friendlyMessage {
    final m = message.toLowerCase();
    if (m.contains('connection') || m.contains('socket') || m.contains('network')) {
      return 'No connection — check your internet';
    }
    if (m.contains('timeout')) return 'Request timed out';
    if (m.contains('401') || m.contains('unauthorized')) return 'Session expired — try signing out';
    if (m.contains('404')) return 'Report not found on server';
    if (m.contains('500')) return 'Server error — try again shortly';
    return 'Could not load report';
  }

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
      Text(_friendlyMessage, textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13,
              fontWeight: FontWeight.w500)),
      const SizedBox(height: 14),
      TextButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh, size: 16),
        label: const Text('Retry'),
      ),
    ]),
  );
}
