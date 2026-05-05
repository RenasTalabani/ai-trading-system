import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/providers/watchlist_provider.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';

class WatchlistScreen extends ConsumerWidget {
  const WatchlistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final assets = ref.watch(watchlistProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: CustomScrollView(
        slivers: [
          const SliverAppBar(
            floating: true,
            snap: true,
            backgroundColor: AppColors.background,
            title: Text('Watchlist',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
          ),

          if (assets.isEmpty)
            const SliverFillRemaining(child: _EmptyWatchlist())
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (ctx, i) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _WatchlistTile(asset: assets[i]),
                  ),
                  childCount: assets.length,
                ),
              ),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddSheet(context, ref, assets),
        backgroundColor: AppColors.primary,
        icon: const Icon(Icons.add, color: Colors.white),
        label: const Text('Add Asset',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
    );
  }

  void _showAddSheet(BuildContext context, WidgetRef ref, List<String> current) {
    HapticFeedback.selectionClick();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      isScrollControlled: true,
      builder: (_) => _AddAssetSheet(current: current),
    );
  }
}

// ── Add Asset Sheet ──────────────────────────────────────────────────────────

class _AddAssetSheet extends ConsumerStatefulWidget {
  final List<String> current;
  const _AddAssetSheet({required this.current});
  @override
  ConsumerState<_AddAssetSheet> createState() => _AddAssetSheetState();
}

class _AddAssetSheetState extends ConsumerState<_AddAssetSheet> {
  String _search = '';

  @override
  Widget build(BuildContext context) {
    final available = allSupportedAssets
        .where((a) => !widget.current.contains(a))
        .where((a) => _search.isEmpty ||
            a.toLowerCase().contains(_search.toLowerCase()) ||
            displayNameFor(a).toLowerCase().contains(_search.toLowerCase()))
        .toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.85,
      expand: false,
      builder: (_, ctrl) => Column(children: [
        const SizedBox(height: 12),
        Container(width: 36, height: 4,
            decoration: BoxDecoration(color: AppColors.border,
                borderRadius: BorderRadius.circular(2))),
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: TextField(
            autofocus: true,
            onChanged: (v) => setState(() => _search = v),
            style: const TextStyle(color: AppColors.textPrimary),
            decoration: const InputDecoration(
              hintText: 'Search assets…',
              prefixIcon: Icon(Icons.search, color: AppColors.textMuted, size: 20),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Expanded(
          child: ListView.builder(
            controller: ctrl,
            itemCount: available.length,
            itemBuilder: (_, i) {
              final a = available[i];
              return ListTile(
                leading: _AssetCircle(asset: a, size: 38),
                title: Text(displayNameFor(a),
                    style: const TextStyle(color: AppColors.textPrimary,
                        fontWeight: FontWeight.w600, fontSize: 15)),
                subtitle: Text(symbolFor(a),
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                trailing: const Icon(Icons.add_circle_outline,
                    color: AppColors.primary, size: 22),
                onTap: () {
                  HapticFeedback.selectionClick();
                  ref.read(watchlistProvider.notifier).add(a);
                  Navigator.pop(context);
                },
              );
            },
          ),
        ),
      ]),
    );
  }
}

// ── Watchlist Tile ───────────────────────────────────────────────────────────

class _WatchlistTile extends ConsumerWidget {
  final String asset;
  const _WatchlistTile({required this.asset});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickerAsync = ref.watch(assetTickerProvider(asset));
    final brainAsync  = ref.watch(brainActionProvider);

    // Find brain signal for this asset from top picks
    String? signal;
    int?    signalConf;
    brainAsync.whenData((r) {
      if (r.bestAsset == asset) {
        signal     = r.action;
        signalConf = r.confidence;
      } else {
        final pick = r.topPicks.where((p) => p.asset == asset).firstOrNull;
        if (pick != null) { signal = pick.action; signalConf = pick.confidence; }
      }
    });

    return GestureDetector(
      onTap: () => _openDetail(context, ref, asset, signal, signalConf),
      onLongPress: () => _confirmRemove(context, ref),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(children: [
          _AssetCircle(asset: asset, size: 44),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(displayNameFor(asset),
                  style: const TextStyle(color: AppColors.textPrimary,
                      fontWeight: FontWeight.w700, fontSize: 15)),
              const SizedBox(height: 2),
              Text(symbolFor(asset),
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
            ]),
          ),
          const SizedBox(width: 8),
          tickerAsync.when(
            loading: () => const SizedBox(width: 80,
                child: Center(child: SizedBox(width: 16, height: 16,
                    child: CircularProgressIndicator(strokeWidth: 1.5,
                        color: AppColors.textMuted)))),
            error: (_, __) => const Text('—',
                style: TextStyle(color: AppColors.textMuted)),
            data: (t) => Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(_fmtPrice(t.price),
                  style: const TextStyle(color: AppColors.textPrimary,
                      fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(height: 2),
              _ChangeBadge(pct: t.changePercent),
            ]),
          ),
          if (signal != null) ...[
            const SizedBox(width: 10),
            _SignalBadge(action: signal!, confidence: signalConf ?? 0),
          ],
        ]),
      ),
    );
  }

  void _openDetail(BuildContext context, WidgetRef ref,
      String asset, String? signal, int? conf) {
    HapticFeedback.selectionClick();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.card,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _AssetDetailSheet(
          asset: asset, signal: signal, signalConf: conf),
    );
  }

  void _confirmRemove(BuildContext context, WidgetRef ref) {
    HapticFeedback.mediumImpact();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        title: Text('Remove ${displayNameFor(asset)}',
            style: const TextStyle(color: AppColors.textPrimary)),
        content: const Text('Remove from watchlist?',
            style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
          TextButton(
            onPressed: () {
              ref.read(watchlistProvider.notifier).remove(asset);
              Navigator.pop(ctx);
            },
            child: const Text('Remove', style: TextStyle(color: AppColors.sell)),
          ),
        ],
      ),
    );
  }
}

// ── Asset Detail Sheet ───────────────────────────────────────────────────────

class _AssetDetailSheet extends ConsumerWidget {
  final String  asset;
  final String? signal;
  final int?    signalConf;
  const _AssetDetailSheet({required this.asset, this.signal, this.signalConf});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickerAsync = ref.watch(assetTickerProvider(asset));
    final newsAsync   = ref.watch(assetNewsProvider(asset));
    final brainAsync  = ref.watch(brainActionProvider);

    // Full brain details if this is the top pick
    ActionReport? fullReport;
    brainAsync.whenData((r) { if (r.bestAsset == asset) fullReport = r; });

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, ctrl) => ListView(
        controller: ctrl,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Center(
            child: Container(width: 36, height: 4,
                decoration: BoxDecoration(color: AppColors.border,
                    borderRadius: BorderRadius.circular(2))),
          ),
          const SizedBox(height: 20),

          // ── Header ────────────────────────────────────────────────────
          Row(children: [
            _AssetCircle(asset: asset, size: 52),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(displayNameFor(asset),
                  style: const TextStyle(color: AppColors.textPrimary,
                      fontWeight: FontWeight.w800, fontSize: 20)),
              Text(symbolFor(asset),
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
            ])),
            if (signal != null) _SignalBadge(action: signal!, confidence: signalConf ?? 0, large: true),
          ]),
          const SizedBox(height: 20),

          // ── Price stats ───────────────────────────────────────────────
          tickerAsync.when(
            loading: () => const Center(
                child: Padding(padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(color: AppColors.primary))),
            error: (_, __) => const Text('Price data unavailable',
                style: TextStyle(color: AppColors.textMuted)),
            data: (t) => _PriceStatsCard(ticker: t),
          ),
          const SizedBox(height: 16),

          // ── Brain signal block (full if top pick, else summary) ────────
          if (signal != null) ...[
            _DetailCard(
              title: 'AI Brain Signal',
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  _SignalBadge(action: signal!, confidence: signalConf ?? 0),
                  const SizedBox(width: 10),
                  Text('${signalConf ?? 0}% confidence',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                ]),
                if (fullReport != null) ...[
                  const SizedBox(height: 12),
                  _TradeLevel('Entry',  fullReport!.entryPrice),
                  _TradeLevel('Stop Loss', fullReport!.stopLoss),
                  _TradeLevel('Take Profit', fullReport!.takeProfit),
                  if (fullReport!.riskReward != null) ...[
                    const SizedBox(height: 8),
                    Text('R:R ${fullReport!.riskReward}',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                  ],
                  const SizedBox(height: 10),
                  Text(fullReport!.reason,
                      style: const TextStyle(color: AppColors.textSecondary,
                          fontSize: 13, height: 1.5)),
                ],
              ]),
            ),
            const SizedBox(height: 16),
          ],

          // ── News ──────────────────────────────────────────────────────
          _DetailCard(
            title: 'Latest News',
            child: newsAsync.when(
              loading: () => const Center(child: Padding(
                  padding: EdgeInsets.all(16),
                  child: CircularProgressIndicator(color: AppColors.primary))),
              error: (_, __) => const Text('No news available',
                  style: TextStyle(color: AppColors.textMuted)),
              data: (items) => items.isEmpty
                  ? const Text('No recent news',
                      style: TextStyle(color: AppColors.textMuted, fontSize: 13))
                  : Column(
                      children: items.take(4).map((n) => _DetailNewsRow(item: n)).toList()),
            ),
          ),
          const SizedBox(height: 16),

          // ── Quick actions ─────────────────────────────────────────────
          Row(children: [
            Expanded(child: _ActionBtn(
              icon: Icons.notifications_none,
              label: 'Set Alert',
              onTap: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Go to Alerts tab to set a price alert'),
                  backgroundColor: AppColors.surface,
                ));
              },
            )),
            const SizedBox(width: 10),
            Expanded(child: _ActionBtn(
              icon: Icons.bookmark_border,
              label: 'Follow Trade',
              primary: signal != null && signal != 'HOLD',
              onTap: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Go to Brain tab to follow the AI trade'),
                  backgroundColor: AppColors.surface,
                ));
              },
            )),
          ]),
        ],
      ),
    );
  }
}

// ── Supporting Widgets ───────────────────────────────────────────────────────

class _AssetCircle extends StatelessWidget {
  final String asset;
  final double size;
  const _AssetCircle({required this.asset, required this.size});

  static const _colors = [
    Color(0xFFF7931A), Color(0xFF627EEA), Color(0xFFF3BA2F),
    Color(0xFF9945FF), Color(0xFF00AAE4), Color(0xFF0033AD),
    Color(0xFFBA9F33), Color(0xFFE84142), Color(0xFF2A5ADA),
    Color(0xFF8247E5),
  ];

  Color _color() {
    final idx = asset.codeUnits.fold(0, (s, c) => s + c) % _colors.length;
    return _colors[idx];
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size, height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _color().withValues(alpha: 0.15),
        border: Border.all(color: _color().withValues(alpha: 0.4)),
      ),
      child: Center(
        child: Text(symbolFor(asset).substring(0, symbolFor(asset).length.clamp(0, 3)),
            style: TextStyle(color: _color(),
                fontWeight: FontWeight.w800, fontSize: size * 0.28)),
      ),
    );
  }
}

class _ChangeBadge extends StatelessWidget {
  final double pct;
  const _ChangeBadge({required this.pct});
  @override
  Widget build(BuildContext context) {
    final up    = pct >= 0;
    final color = up ? AppColors.buy : AppColors.sell;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text('${up ? '+' : ''}${pct.toStringAsFixed(2)}%',
          style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

class _SignalBadge extends StatelessWidget {
  final String action;
  final int    confidence;
  final bool   large;
  const _SignalBadge({required this.action, required this.confidence, this.large = false});
  @override
  Widget build(BuildContext context) {
    final color = action == 'BUY'  ? AppColors.buy
                : action == 'SELL' ? AppColors.sell
                :                    AppColors.hold;
    final fs = large ? 13.0 : 11.0;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: large ? 10 : 7, vertical: large ? 5 : 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(action,
          style: TextStyle(color: color, fontSize: fs, fontWeight: FontWeight.w800)),
    );
  }
}

class _PriceStatsCard extends StatelessWidget {
  final AssetTicker ticker;
  const _PriceStatsCard({required this.ticker});
  @override
  Widget build(BuildContext context) {
    final fmt = NumberFormat.currency(symbol: '\$', decimalDigits: ticker.price < 1 ? 6 : ticker.price < 10 ? 4 : 2);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(fmt.format(ticker.price),
              style: const TextStyle(color: AppColors.textPrimary,
                  fontWeight: FontWeight.w800, fontSize: 28)),
          _ChangeBadge(pct: ticker.changePercent),
        ]),
        const SizedBox(height: 14),
        Row(children: [
          _StatItem('24h High', _fmtPrice(ticker.high24h)),
          _StatItem('24h Low',  _fmtPrice(ticker.low24h)),
          _StatItem('Volume',   _fmtVol(ticker.quoteVolume24h)),
        ]),
      ]),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label, value;
  const _StatItem(this.label, this.value);
  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(children: [
      Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
      const SizedBox(height: 3),
      Text(value, style: const TextStyle(color: AppColors.textSecondary,
          fontSize: 13, fontWeight: FontWeight.w600)),
    ]),
  );
}

class _DetailCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _DetailCard({required this.title, required this.child});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title,
          style: const TextStyle(color: AppColors.textPrimary,
              fontWeight: FontWeight.w700, fontSize: 14)),
      const SizedBox(height: 12),
      child,
    ]),
  );
}

class _TradeLevel extends StatelessWidget {
  final String  label;
  final double? value;
  const _TradeLevel(this.label, this.value);
  @override
  Widget build(BuildContext context) {
    if (value == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
        Text(_fmtPrice(value!),
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 13,
                fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class _DetailNewsRow extends StatelessWidget {
  final dynamic item; // NewsItem
  const _DetailNewsRow({required this.item});
  @override
  Widget build(BuildContext context) {
    final color = item.sentiment == 'bullish' ? AppColors.buy
                : item.sentiment == 'bearish' ? AppColors.sell
                : AppColors.textMuted;
    return GestureDetector(
      onTap: () async {
        if (item.url != null) {
          await launchUrl(Uri.parse(item.url!), mode: LaunchMode.externalApplication);
        }
      },
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 3, height: 40,
              margin: const EdgeInsets.only(right: 10, top: 2),
              decoration: BoxDecoration(color: color,
                  borderRadius: BorderRadius.circular(2))),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.title,
                maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.textPrimary,
                    fontSize: 13, height: 1.3)),
            const SizedBox(height: 2),
            Text(item.source,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          ])),
          if (item.url != null)
            const Padding(padding: EdgeInsets.only(left: 8),
                child: Icon(Icons.open_in_new, size: 14, color: AppColors.textMuted)),
        ]),
      ),
    );
  }
}

class _ActionBtn extends StatelessWidget {
  final IconData icon;
  final String   label;
  final bool     primary;
  final VoidCallback onTap;
  const _ActionBtn({required this.icon, required this.label,
      required this.onTap, this.primary = false});
  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 13),
      decoration: BoxDecoration(
        color: primary ? AppColors.primary.withValues(alpha: 0.15) : AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: primary ? AppColors.primary.withValues(alpha: 0.4) : AppColors.border),
      ),
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(icon, size: 16, color: primary ? AppColors.primary : AppColors.textSecondary),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(
            color: primary ? AppColors.primary : AppColors.textSecondary,
            fontSize: 13, fontWeight: FontWeight.w600)),
      ]),
    ),
  );
}

class _EmptyWatchlist extends StatelessWidget {
  const _EmptyWatchlist();
  @override
  Widget build(BuildContext context) => const Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Icon(Icons.remove_red_eye_outlined, size: 56, color: AppColors.textMuted),
      SizedBox(height: 16),
      Text('Your watchlist is empty',
          style: TextStyle(color: AppColors.textPrimary,
              fontSize: 18, fontWeight: FontWeight.w700)),
      SizedBox(height: 8),
      Text('Tap + Add Asset to start tracking',
          style: TextStyle(color: AppColors.textMuted, fontSize: 14)),
    ]),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

String _fmtPrice(double v) {
  if (v >= 1000) return '\$${NumberFormat('#,##0.00').format(v)}';
  if (v >= 1)    return '\$${v.toStringAsFixed(2)}';
  if (v >= 0.01) return '\$${v.toStringAsFixed(4)}';
  return '\$${v.toStringAsFixed(6)}';
}

String _fmtVol(double v) {
  if (v >= 1e9) return '\$${(v / 1e9).toStringAsFixed(1)}B';
  if (v >= 1e6) return '\$${(v / 1e6).toStringAsFixed(1)}M';
  if (v >= 1e3) return '\$${(v / 1e3).toStringAsFixed(1)}K';
  return '\$${v.toStringAsFixed(0)}';
}
