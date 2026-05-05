import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/watchlist_provider.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/providers/prices_provider.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/sparkline_chart.dart';

class MarketScannerScreen extends ConsumerStatefulWidget {
  const MarketScannerScreen({super.key});

  @override
  ConsumerState<MarketScannerScreen> createState() =>
      _MarketScannerScreenState();
}

class _MarketScannerScreenState extends ConsumerState<MarketScannerScreen> {
  String _filter = 'ALL'; // ALL / BUY / SELL / HOLD
  String _sort   = 'CONF'; // CONF / NAME / PRICE

  @override
  Widget build(BuildContext context) {
    final brainAsync   = ref.watch(brainActionProvider);
    final prices       = ref.watch(pricesProvider);
    final tickersAsync = ref.watch(batchTickerProvider(allSupportedAssets));

    // Build ticker map for quick lookup
    final tickerMap = <String, AssetTicker>{};
    tickersAsync.whenData((list) {
      for (final t in list) { tickerMap[t.asset] = t; }
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      body: brainAsync.when(
        loading: () => const Center(
            child: CircularProgressIndicator(color: AppColors.primary)),
        error: (e, _) => Center(
            child: Text('$e',
                style: const TextStyle(color: AppColors.textMuted))),
        data: (report) {
          // Merge best asset + top picks into a signal map
          final signalMap = <String, _SignalEntry>{};
          signalMap[report.bestAsset] = _SignalEntry(
            action:     report.action,
            confidence: report.confidence,
            assetClass: report.assetClass,
          );
          for (final p in report.topPicks) {
            signalMap[p.asset] = _SignalEntry(
              action:     p.action,
              confidence: p.confidence,
              assetClass: p.assetClass,
            );
          }

          // Build full item list
          var items = allSupportedAssets.map((asset) {
            final sig    = signalMap[asset];
            final ticker = tickerMap[asset];
            return _ScanItem(
              asset:         asset,
              displayName:   displayNameFor(asset),
              action:        sig?.action     ?? 'HOLD',
              confidence:    sig?.confidence ?? 0,
              assetClass:    sig?.assetClass ?? 'crypto',
              price:         prices[asset] ?? ticker?.price,
              changePercent: ticker?.changePercent,
            );
          }).toList();

          // Filter
          if (_filter != 'ALL') {
            items = items.where((i) => i.action == _filter).toList();
          }

          // Sort
          switch (_sort) {
            case 'CONF':
              items.sort((a, b) => b.confidence.compareTo(a.confidence));
            case 'NAME':
              items.sort((a, b) => a.displayName.compareTo(b.displayName));
            case 'PRICE':
              items.sort((a, b) =>
                  (b.price ?? 0).compareTo(a.price ?? 0));
          }

          // Counts for mood bar
          final allActions = allSupportedAssets
              .map((a) => signalMap[a]?.action ?? 'HOLD')
              .toList();
          final buyCount  = allActions.where((a) => a == 'BUY').length;
          final sellCount = allActions.where((a) => a == 'SELL').length;
          final holdCount = allActions.where((a) => a == 'HOLD').length;

          return CustomScrollView(
            slivers: [
              // ── App bar ────────────────────────────────────────────────
              SliverAppBar(
                floating: true,
                snap: true,
                backgroundColor: AppColors.background,
                title: const Text('Market Radar',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                actions: [
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.sort,
                        color: AppColors.textSecondary),
                    color: AppColors.card,
                    onSelected: (v) => setState(() => _sort = v),
                    itemBuilder: (_) => [
                      _menuItem('CONF',  'By Confidence', _sort),
                      _menuItem('PRICE', 'By Price',      _sort),
                      _menuItem('NAME',  'By Name',       _sort),
                    ],
                  ),
                ],
              ),

              // ── Mood bar ───────────────────────────────────────────────
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                  child: _MoodBar(
                    buyCount:       buyCount,
                    sellCount:      sellCount,
                    holdCount:      holdCount,
                    fearGreed:      report.fearGreed,
                    fearGreedClass: report.fearGreedClass,
                    totalEvaluated: report.totalEvaluated,
                  ),
                ),
              ),

              // ── Filter chips ───────────────────────────────────────────
              SliverToBoxAdapter(
                child: _FilterBar(
                  current:   _filter,
                  onChanged: (v) => setState(() => _filter = v),
                  counts: {
                    'ALL':  allSupportedAssets.length,
                    'BUY':  buyCount,
                    'SELL': sellCount,
                    'HOLD': holdCount,
                  },
                ),
              ),

              // ── Asset list ─────────────────────────────────────────────
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (_, i) => _ScannerTile(
                      item:   items[i],
                      isBest: items[i].asset == report.bestAsset,
                      fullReport: items[i].asset == report.bestAsset
                          ? report
                          : null,
                    ),
                    childCount: items.length,
                  ),
                ),
              ),
            ],
          );
        },
      ),

      // ── Follow Top Signal FAB ──────────────────────────────────────────
      floatingActionButton: brainAsync.valueOrNull != null &&
              brainAsync.valueOrNull!.action != 'HOLD'
          ? FloatingActionButton.extended(
              backgroundColor: AppColors.buy,
              onPressed: () => _followTop(brainAsync.valueOrNull!),
              icon: const Icon(Icons.flash_on, color: Colors.white),
              label: Text(
                'Follow ${brainAsync.valueOrNull!.action}  '
                '${brainAsync.valueOrNull!.displayName}',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w700),
              ),
            )
          : null,
    );
  }

  PopupMenuItem<String> _menuItem(
      String value, String label, String current) =>
      PopupMenuItem(
        value: value,
        child: Row(children: [
          Icon(
            current == value ? Icons.check : Icons.circle_outlined,
            size: 14,
            color: current == value ? AppColors.primary : AppColors.textMuted,
          ),
          const SizedBox(width: 8),
          Text(label,
              style: TextStyle(
                  fontSize: 13,
                  color: current == value
                      ? AppColors.primary
                      : AppColors.textPrimary,
                  fontWeight: current == value
                      ? FontWeight.w700
                      : FontWeight.normal)),
        ]),
      );

  Future<void> _followTop(ActionReport report) async {
    HapticFeedback.mediumImpact();
    final already = ref.read(followsProvider).follows
        .any((f) => f.asset == report.bestAsset && f.isOpen);
    if (already) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Already following this trade'),
        backgroundColor: AppColors.surface,
      ));
      return;
    }
    final ok = await ref.read(followsProvider.notifier).followTrade({
      'asset':       report.bestAsset,
      'displayName': report.displayName,
      'action':      report.action,
      'entryPrice':  report.entryPrice,
      'stopLoss':    report.stopLoss,
      'takeProfit':  report.takeProfit,
      'confidence':  report.confidence,
      'timeframe':   report.timeframe,
    });
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(ok
          ? '✅ Following ${report.displayName} ${report.action}'
          : 'Already following ${report.displayName}'),
      backgroundColor:
          ok ? AppColors.buy.withValues(alpha: 0.9) : AppColors.surface,
    ));
  }
}

// ── Data classes ──────────────────────────────────────────────────────────────

class _SignalEntry {
  final String action;
  final int    confidence;
  final String assetClass;
  const _SignalEntry({
    required this.action, required this.confidence, required this.assetClass,
  });
}

class _ScanItem {
  final String  asset;
  final String  displayName;
  final String  action;
  final int     confidence;
  final String  assetClass;
  final double? price;
  final double? changePercent;
  const _ScanItem({
    required this.asset,    required this.displayName,
    required this.action,   required this.confidence,
    required this.assetClass,
    this.price, this.changePercent,
  });
}

// ── Mood Bar ──────────────────────────────────────────────────────────────────

class _MoodBar extends StatelessWidget {
  final int     buyCount;
  final int     sellCount;
  final int     holdCount;
  final int?    fearGreed;
  final String? fearGreedClass;
  final int     totalEvaluated;

  const _MoodBar({
    required this.buyCount,  required this.sellCount,
    required this.holdCount, required this.totalEvaluated,
    this.fearGreed, this.fearGreedClass,
  });

  @override
  Widget build(BuildContext context) {
    final total = buyCount + sellCount + holdCount;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: [
        Row(children: [
          _MoodStat('BUY',  '$buyCount',  AppColors.buy),
          const SizedBox(width: 20),
          _MoodStat('HOLD', '$holdCount', AppColors.hold),
          const SizedBox(width: 20),
          _MoodStat('SELL', '$sellCount', AppColors.sell),
          const Spacer(),
          if (fearGreed != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: _fgColor(fearGreed!).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                    color: _fgColor(fearGreed!).withValues(alpha: 0.3)),
              ),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text('$fearGreed',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: _fgColor(fearGreed!))),
                Text(
                  (fearGreedClass ?? 'NEUTRAL').toUpperCase(),
                  style: TextStyle(
                      fontSize: 8,
                      color: _fgColor(fearGreed!),
                      letterSpacing: 0.5),
                ),
              ]),
            ),
        ]),
        if (total > 0) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Row(children: [
              if (buyCount  > 0)
                Flexible(
                    flex: buyCount,
                    child: Container(height: 5, color: AppColors.buy)),
              if (holdCount > 0)
                Flexible(
                    flex: holdCount,
                    child: Container(height: 5, color: AppColors.hold)),
              if (sellCount > 0)
                Flexible(
                    flex: sellCount,
                    child: Container(height: 5, color: AppColors.sell)),
            ]),
          ),
        ],
        const SizedBox(height: 6),
        Text('$totalEvaluated assets evaluated by AI Brain',
            style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
      ]),
    );
  }

  Color _fgColor(int fg) {
    if (fg >= 60) return AppColors.buy;
    if (fg >= 40) return AppColors.hold;
    return AppColors.sell;
  }
}

class _MoodStat extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _MoodStat(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) =>
      Column(mainAxisSize: MainAxisSize.min, children: [
        Text(value,
            style: TextStyle(
                fontSize: 22, fontWeight: FontWeight.w800, color: color)),
        Text(label,
            style: TextStyle(
                fontSize: 9, color: color, letterSpacing: 1.2)),
      ]);
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

class _FilterBar extends StatelessWidget {
  final String                current;
  final void Function(String) onChanged;
  final Map<String, int>      counts;
  const _FilterBar({
    required this.current, required this.onChanged, required this.counts,
  });

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 44,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      children: ['ALL', 'BUY', 'SELL', 'HOLD'].map((f) {
        final sel   = f == current;
        final color = f == 'BUY'  ? AppColors.buy
            : f == 'SELL' ? AppColors.sell
            : f == 'HOLD' ? AppColors.hold
            : AppColors.primary;
        return GestureDetector(
          onTap: () => onChanged(f),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            margin: const EdgeInsets.only(right: 8),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: sel ? color.withValues(alpha: 0.15) : AppColors.card,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                  color: sel ? color : AppColors.border),
            ),
            child: Center(
              child: Text(
                '$f  ${counts[f] ?? 0}',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight:
                        sel ? FontWeight.w700 : FontWeight.normal,
                    color:
                        sel ? color : AppColors.textSecondary),
              ),
            ),
          ),
        );
      }).toList(),
    ),
  );
}

// ── Scanner Tile ──────────────────────────────────────────────────────────────

class _ScannerTile extends ConsumerWidget {
  final _ScanItem     item;
  final bool          isBest;
  final ActionReport? fullReport;
  const _ScannerTile({
    required this.item, required this.isBest, this.fullReport,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actionColor = item.action == 'BUY'  ? AppColors.buy
        : item.action == 'SELL' ? AppColors.sell
        : AppColors.hold;

    final changeColor = (item.changePercent ?? 0) >= 0
        ? AppColors.buy
        : AppColors.sell;

    return GestureDetector(
      onTap: () => _showDetail(context, ref),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isBest
                ? actionColor.withValues(alpha: 0.5)
                : AppColors.border,
            width: isBest ? 1.5 : 1,
          ),
        ),
        child: Row(children: [
          _ScanCircle(asset: item.asset),
          const SizedBox(width: 12),

          // Name + confidence bar
          Expanded(
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
              Row(children: [
                Flexible(
                  child: Text(item.displayName,
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary),
                      overflow: TextOverflow.ellipsis),
                ),
                if (isBest) ...[
                  const SizedBox(width: 5),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 5, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text('TOP',
                        style: TextStyle(
                            fontSize: 8,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primary,
                            letterSpacing: 0.5)),
                  ),
                ],
              ]),
              const SizedBox(height: 5),
              Row(children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(3),
                    child: LinearProgressIndicator(
                      value:           item.confidence / 100,
                      minHeight:       3,
                      backgroundColor: AppColors.border,
                      valueColor:
                          AlwaysStoppedAnimation(actionColor),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Text('${item.confidence}%',
                    style: TextStyle(
                        fontSize: 10,
                        color: actionColor,
                        fontWeight: FontWeight.w700)),
              ]),
            ]),
          ),

          const SizedBox(width: 8),
          SparklineChart(asset: item.asset, width: 56, height: 28),
          const SizedBox(width: 8),

          // Price column
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (item.price != null)
              Text(_fmt(item.price!),
                  style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
            const SizedBox(height: 3),
            if (item.changePercent != null)
              Text(
                '${item.changePercent! >= 0 ? '+' : ''}'
                '${item.changePercent!.toStringAsFixed(1)}%',
                style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: changeColor),
              )
            else
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: actionColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                      color: actionColor.withValues(alpha: 0.3)),
                ),
                child: Text(item.action,
                    style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color: actionColor)),
              ),
            if (item.changePercent != null) ...[
              const SizedBox(height: 2),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: actionColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(item.action,
                    style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        color: actionColor)),
              ),
            ],
          ]),
        ]),
      ),
    );
  }

  void _showDetail(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ScannerDetail(
          item: item, fullReport: fullReport),
    );
  }

  String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }
}

// ── Scanner Detail ────────────────────────────────────────────────────────────

class _ScannerDetail extends ConsumerStatefulWidget {
  final _ScanItem     item;
  final ActionReport? fullReport;
  const _ScannerDetail({required this.item, this.fullReport});

  @override
  ConsumerState<_ScannerDetail> createState() => _ScannerDetailState();
}

class _ScannerDetailState extends ConsumerState<_ScannerDetail> {
  bool _following = false;

  @override
  Widget build(BuildContext context) {
    final actionColor = widget.item.action == 'BUY'  ? AppColors.buy
        : widget.item.action == 'SELL' ? AppColors.sell : AppColors.hold;
    final alreadyFollowing = ref
        .watch(followsProvider)
        .follows
        .any((f) => f.asset == widget.item.asset && f.isOpen);

    final r = widget.fullReport;

    return DraggableScrollableSheet(
      initialChildSize: 0.55,
      minChildSize: 0.4,
      maxChildSize: 0.85,
      expand: false,
      builder: (_, ctrl) => ListView(
        controller: ctrl,
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Center(
            child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2))),
          ),
          const SizedBox(height: 16),

          // Header
          Row(children: [
            _ScanCircle(asset: widget.item.asset, size: 52),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(widget.item.displayName,
                    style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                Text(symbolFor(widget.item.asset),
                    style: const TextStyle(
                        fontSize: 13, color: AppColors.textMuted)),
              ]),
            ),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: actionColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: actionColor.withValues(alpha: 0.3)),
                ),
                child: Text(widget.item.action,
                    style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: actionColor)),
              ),
              const SizedBox(height: 4),
              Text('${widget.item.confidence}% conf',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textMuted)),
            ]),
          ]),
          const SizedBox(height: 16),

          // Price + 24h row
          if (widget.item.price != null) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(children: [
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    const Text('Live Price',
                        style: TextStyle(
                            color: AppColors.textMuted, fontSize: 11)),
                    const SizedBox(height: 2),
                    Text(_fmt(widget.item.price!),
                        style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary)),
                  ]),
                ),
                if (widget.item.changePercent != null) ...[
                  const VerticalDivider(color: AppColors.border),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    const Text('24h Change',
                        style: TextStyle(
                            color: AppColors.textMuted, fontSize: 11)),
                    const SizedBox(height: 2),
                    Text(
                      '${widget.item.changePercent! >= 0 ? '+' : ''}'
                      '${widget.item.changePercent!.toStringAsFixed(2)}%',
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: widget.item.changePercent! >= 0
                              ? AppColors.buy
                              : AppColors.sell),
                    ),
                  ]),
                ],
              ]),
            ),
            const SizedBox(height: 12),
          ],

          // Trade levels (only for best asset with full report)
          if (r != null) ...[
            if (r.entryPrice != null)
              _LevelRow('Entry',       r.entryPrice!,  AppColors.primary),
            if (r.stopLoss != null)
              _LevelRow('Stop Loss',   r.stopLoss!,    AppColors.sell),
            if (r.takeProfit != null)
              _LevelRow('Take Profit', r.takeProfit!,  AppColors.buy),
            if (r.riskReward != null) ...[
              const SizedBox(height: 8),
              Text('Risk:Reward  ${r.riskReward}',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 13)),
            ],
            const SizedBox(height: 12),
          ],

          // Follow button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: alreadyFollowing
                    ? AppColors.surface
                    : actionColor,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
                side: alreadyFollowing
                    ? const BorderSide(color: AppColors.border)
                    : BorderSide.none,
              ),
              onPressed:
                  alreadyFollowing || _following ? null : _follow,
              icon: Icon(
                alreadyFollowing ? Icons.check : Icons.bookmark_outline,
                color: alreadyFollowing
                    ? AppColors.textMuted
                    : Colors.white,
              ),
              label: Text(
                alreadyFollowing
                    ? 'Already Following'
                    : _following
                        ? 'Following...'
                        : 'Follow This Trade',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: alreadyFollowing
                        ? AppColors.textMuted
                        : Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _follow() async {
    HapticFeedback.mediumImpact();
    setState(() => _following = true);
    final r  = widget.fullReport;
    final ok = await ref.read(followsProvider.notifier).followTrade({
      'asset':       widget.item.asset,
      'displayName': widget.item.displayName,
      'action':      widget.item.action,
      'confidence':  widget.item.confidence,
      if (widget.item.price != null) 'entryPrice': widget.item.price,
      if (r?.stopLoss   != null) 'stopLoss':   r!.stopLoss,
      if (r?.takeProfit != null) 'takeProfit': r!.takeProfit,
      'timeframe':   r?.timeframe ?? '4H',
    });
    if (!mounted) return;
    setState(() => _following = false);
    Navigator.pop(context);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(ok
          ? '✅ Now following ${widget.item.displayName} ${widget.item.action}'
          : 'Already following this asset'),
      backgroundColor:
          ok ? AppColors.buy.withValues(alpha: 0.9) : AppColors.surface,
    ));
  }

  String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }
}

class _LevelRow extends StatelessWidget {
  final String label;
  final double value;
  final Color  color;
  const _LevelRow(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Row(children: [
      Container(width: 3, height: 18,
          margin: const EdgeInsets.only(right: 10),
          decoration: BoxDecoration(
              color: color, borderRadius: BorderRadius.circular(2))),
      Text(label,
          style: const TextStyle(
              fontSize: 13, color: AppColors.textSecondary)),
      const Spacer(),
      Text(_fmt(value),
          style: TextStyle(
              fontSize: 13, fontWeight: FontWeight.w700, color: color)),
    ]),
  );

  static String _fmt(double v) {
    if (v >= 10000) return '\$${v.toStringAsFixed(0)}';
    if (v >= 100)   return '\$${v.toStringAsFixed(1)}';
    if (v >= 1)     return '\$${v.toStringAsFixed(2)}';
    return '\$${v.toStringAsFixed(4)}';
  }
}

// ── Asset Circle ──────────────────────────────────────────────────────────────

class _ScanCircle extends StatelessWidget {
  final String asset;
  final double size;
  const _ScanCircle({required this.asset, this.size = 42});

  static const _colors = [
    Color(0xFFF7931A), Color(0xFF627EEA), Color(0xFFF3BA2F),
    Color(0xFF9945FF), Color(0xFF00AAE4), Color(0xFF0033AD),
    Color(0xFFBA9F33), Color(0xFFE84142), Color(0xFF2A5ADA),
    Color(0xFF8247E5),
  ];

  @override
  Widget build(BuildContext context) {
    final sym   = symbolFor(asset);
    final color = _colors[
        sym.codeUnits.fold(0, (a, b) => a + b) % _colors.length];
    return Container(
      width: size, height: size,
      decoration: BoxDecoration(
        color:  color.withValues(alpha: 0.15),
        shape:  BoxShape.circle,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Center(
        child: Text(
          sym.length > 3 ? sym.substring(0, 3) : sym,
          style: TextStyle(
              fontSize:   size * 0.27,
              fontWeight: FontWeight.w800,
              color:      color),
        ),
      ),
    );
  }
}
