import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers/strategy_provider.dart';
import '../../core/models/strategy_model.dart';
import '../../core/providers/order_block_provider.dart';
import '../../core/models/order_block_model.dart';

class StrategyScreen extends ConsumerStatefulWidget {
  const StrategyScreen({super.key});

  @override
  ConsumerState<StrategyScreen> createState() => _StrategyScreenState();
}

class _StrategyScreenState extends ConsumerState<StrategyScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;
  final _capitalCtrl = TextEditingController(text: '500');

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    _capitalCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Strategy Intelligence'),
        bottom: TabBar(
          controller: _tabCtrl,
          indicatorColor: AppColors.primary,
          labelColor: AppColors.primary,
          unselectedLabelColor: AppColors.textSecondary,
          tabs: const [Tab(text: 'Analysis'), Tab(text: 'Simulator'), Tab(text: 'Order Blocks')],
        ),
      ),
      body: Column(
        children: [
          // ── Config panel (shared across tabs) ────────────────────────────
          _ConfigPanel(capitalCtrl: _capitalCtrl),

          // ── Tab views ────────────────────────────────────────────────────
          Expanded(
            child: TabBarView(
              controller: _tabCtrl,
              children: const [_AnalysisTab(), _SimulatorTab(), _OrderBlocksTab()],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Config panel ─────────────────────────────────────────────────────────────

class _ConfigPanel extends ConsumerWidget {
  final TextEditingController capitalCtrl;
  const _ConfigPanel({required this.capitalCtrl});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final form = ref.watch(strategyFormProvider);

    return Container(
      color: AppColors.card,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Asset chips
        const Text('Select Assets',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: kTrackedAssets.map((asset) {
          final selected = form.selectedAssets.contains(asset);
          final label    = asset.replaceAll('USDT', '');
          return GestureDetector(
            onTap: () {
              final set = Set<String>.from(form.selectedAssets);
              if (selected) {
                if (set.length > 1) set.remove(asset);
              } else {
                set.add(asset);
              }
              ref.read(strategyFormProvider.notifier).state =
                  form.copyWith(selectedAssets: set);
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color:  selected ? AppColors.primary : AppColors.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: selected ? AppColors.primary : AppColors.border,
                ),
              ),
              child: Text(label,
                  style: TextStyle(
                    fontSize: 12,
                    color:  selected ? Colors.white : AppColors.textSecondary,
                    fontWeight: selected ? FontWeight.bold : FontWeight.normal,
                  )),
            ),
          );
        }).toList()),

        const SizedBox(height: 12),

        // Timeframe + capital row
        Row(children: [
          // Timeframe selector
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Timeframe',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              const SizedBox(height: 6),
              _TimeframeSelector(current: form.timeframe,
                  onChanged: (v) => ref.read(strategyFormProvider.notifier).state =
                      form.copyWith(timeframe: v)),
            ]),
          ),
          const SizedBox(width: 16),
          // Capital input
          SizedBox(width: 120, child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Capital (USD)',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              const SizedBox(height: 6),
              TextField(
                controller: capitalCtrl,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                onChanged: (v) {
                  final d = double.tryParse(v);
                  if (d != null && d > 0) {
                    ref.read(strategyFormProvider.notifier).state =
                        form.copyWith(capital: d);
                  }
                },
                decoration: InputDecoration(
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  prefixText: '\$',
                  prefixStyle: const TextStyle(color: AppColors.textSecondary),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: AppColors.primary),
                  ),
                ),
              ),
            ],
          )),
        ]),
      ]),
    );
  }
}

class _TimeframeSelector extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;
  const _TimeframeSelector({required this.current, required this.onChanged});

  static const _opts = [('1D', '1d'), ('7D', '7d'), ('30D', '30d')];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: _opts.map((o) {
        final sel = current == o.$2;
        return Expanded(
          child: GestureDetector(
            onTap: () => onChanged(o.$2),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(vertical: 6),
              decoration: BoxDecoration(
                color: sel ? AppColors.primary : Colors.transparent,
                borderRadius: BorderRadius.circular(5),
              ),
              child: Text(o.$1,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: sel ? FontWeight.bold : FontWeight.normal,
                      color: sel ? Colors.white : AppColors.textSecondary)),
            ),
          ),
        );
      }).toList()),
    );
  }
}

// ─── Analysis tab ─────────────────────────────────────────────────────────────

class _AnalysisTab extends ConsumerWidget {
  const _AnalysisTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final holdAsync = ref.watch(holdingProvider);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: holdAsync.when(
        data: (result) {
          if (result == null) {
            return _AnalysisEmpty(
                onAnalyze: () => ref.read(holdingProvider.notifier).analyze());
          }
          return _AnalysisResult(result: result,
              onRefresh: () => ref.read(holdingProvider.notifier).analyze());
        },
        loading: () => const Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(color: AppColors.primary),
            SizedBox(height: 16),
            Text('Analyzing market conditions…',
                style: TextStyle(color: AppColors.textSecondary)),
          ]),
        ),
        error: (e, _) => _ErrorView(
          message: e.toString(),
          onRetry: () => ref.read(holdingProvider.notifier).analyze(),
        ),
      ),
    );
  }
}

class _AnalysisEmpty extends StatelessWidget {
  final VoidCallback onAnalyze;
  const _AnalysisEmpty({required this.onAnalyze});

  @override
  Widget build(BuildContext context) {
    return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.analytics_outlined, size: 44, color: AppColors.textMuted),
      const SizedBox(height: 10),
      const Text('Get AI Recommendations',
          style: TextStyle(fontSize: 16, color: AppColors.textPrimary,
              fontWeight: FontWeight.w600)),
      const SizedBox(height: 6),
      const Text('Select assets & timeframe above,\nthen tap Analyze.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      const SizedBox(height: 16),
      ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        icon: const Icon(Icons.search),
        label: const Text('Analyze Now', style: TextStyle(fontSize: 15)),
        onPressed: onAnalyze,
      ),
    ]));
  }
}

class _AnalysisResult extends StatelessWidget {
  final HoldingResult result;
  final VoidCallback  onRefresh;
  const _AnalysisResult({required this.result, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    return ListView(children: [
      // Best asset banner
      if (result.bestAsset != null)
        _BestAssetCard(asset: result.bestAsset!, rec: result.bestRec ?? 'BUY'),
      const SizedBox(height: 12),

      // Summary chips
      Row(children: [
        Expanded(child: _StatCard(
          label: 'Expected Gain',
          value: '+\$${result.expectedProfit.toStringAsFixed(2)}',
          color: AppColors.buy,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'Expected Risk',
          value: '-\$${result.expectedLoss.abs().toStringAsFixed(2)}',
          color: AppColors.sell,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'Win Rate',
          value: '${result.winRate.toStringAsFixed(0)}%',
          color: AppColors.primary,
        )),
      ]),
      const SizedBox(height: 16),

      const Text('Per-Asset Recommendations',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12,
              fontWeight: FontWeight.w500)),
      const SizedBox(height: 8),

      ...result.recommendations.map((r) => _RecommendationCard(rec: r)),

      const SizedBox(height: 16),
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textSecondary,
          side: const BorderSide(color: AppColors.border),
          padding: const EdgeInsets.symmetric(vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        icon: const Icon(Icons.refresh, size: 16),
        label: const Text('Re-analyze'),
        onPressed: onRefresh,
      ),
    ]);
  }
}

// ─── Simulator tab ────────────────────────────────────────────────────────────

class _SimulatorTab extends ConsumerWidget {
  const _SimulatorTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final simAsync = ref.watch(simulationProvider);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: simAsync.when(
        data: (result) {
          if (result == null) {
            return _SimulatorEmpty(
                onSimulate: () => ref.read(simulationProvider.notifier).simulate());
          }
          return _SimulationResult(result: result,
              onRefresh: () => ref.read(simulationProvider.notifier).simulate());
        },
        loading: () => const Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(color: AppColors.primary),
            SizedBox(height: 16),
            Text('Running historical simulation…',
                style: TextStyle(color: AppColors.textSecondary)),
          ]),
        ),
        error: (e, _) => _ErrorView(
          message: e.toString(),
          onRetry: () => ref.read(simulationProvider.notifier).simulate(),
        ),
      ),
    );
  }
}

class _SimulatorEmpty extends StatelessWidget {
  final VoidCallback onSimulate;
  const _SimulatorEmpty({required this.onSimulate});

  @override
  Widget build(BuildContext context) {
    return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.history_edu_outlined, size: 44, color: AppColors.textMuted),
      const SizedBox(height: 10),
      const Text('Backtest the Strategy',
          style: TextStyle(fontSize: 16, color: AppColors.textPrimary,
              fontWeight: FontWeight.w600)),
      const SizedBox(height: 6),
      const Text('Simulate what would have happened\nif you followed the AI strategy.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      const SizedBox(height: 16),
      ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        icon: const Icon(Icons.play_arrow),
        label: const Text('Run Simulation', style: TextStyle(fontSize: 15)),
        onPressed: onSimulate,
      ),
    ]));
  }
}

class _SimulationResult extends StatelessWidget {
  final SimulationResult result;
  final VoidCallback     onRefresh;
  const _SimulationResult({required this.result, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final isProfit = result.isProfitable;
    final pnlColor = isProfit ? AppColors.buy : AppColors.sell;
    final sign     = isProfit ? '+' : '';

    return ListView(children: [
      // Summary card
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Simulation Result',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 6),
          Row(children: [
            Text('\$${result.initialBalance.toStringAsFixed(2)}',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 16)),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8),
              child: Icon(Icons.arrow_forward, color: AppColors.textMuted, size: 16),
            ),
            Text('\$${result.finalBalance.toStringAsFixed(2)}',
                style: TextStyle(
                    color: pnlColor, fontSize: 22, fontWeight: FontWeight.bold)),
          ]),
          const SizedBox(height: 4),
          Text('$sign\$${result.netPnl.toStringAsFixed(2)} '
              '($sign${result.returnPct.toStringAsFixed(2)}%)',
              style: TextStyle(color: pnlColor, fontWeight: FontWeight.w600)),
        ]),
      ),
      const SizedBox(height: 12),

      Row(children: [
        Expanded(child: _StatCard(
          label: 'Total Profit',
          value: '+\$${result.profit.toStringAsFixed(2)}',
          color: AppColors.buy,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'Total Loss',
          value: '-\$${result.loss.toStringAsFixed(2)}',
          color: AppColors.sell,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'Win Rate',
          value: '${result.winRate.toStringAsFixed(0)}%',
          color: AppColors.primary,
        )),
      ]),
      const SizedBox(height: 8),

      _StatCard(
        label: 'Total Trades Simulated',
        value: '${result.totalTrades}',
        color: AppColors.textPrimary,
        fullWidth: true,
      ),
      const SizedBox(height: 16),

      if (result.perAsset.isNotEmpty) ...[
        const Text('Per-Asset Breakdown',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12,
                fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        ...result.perAsset.map((r) => _SimAssetCard(rec: r)),
      ],

      const SizedBox(height: 16),
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textSecondary,
          side: const BorderSide(color: AppColors.border),
          padding: const EdgeInsets.symmetric(vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        icon: const Icon(Icons.refresh, size: 16),
        label: const Text('Re-run Simulation'),
        onPressed: onRefresh,
      ),
    ]);
  }
}

// ─── Shared widgets ───────────────────────────────────────────────────────────

class _BestAssetCard extends StatelessWidget {
  final String asset;
  final String rec;
  const _BestAssetCard({required this.asset, required this.rec});

  @override
  Widget build(BuildContext context) {
    final color = rec == 'BUY' ? AppColors.buy : rec == 'SELL' ? AppColors.sell : AppColors.hold;
    final label = asset.replaceAll('USDT', '');
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withAlpha(80)),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: color.withAlpha(50),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(rec, style: TextStyle(
              color: color, fontWeight: FontWeight.bold, fontSize: 13)),
        ),
        const SizedBox(width: 12),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Best Opportunity',
              style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
          Text(label, style: const TextStyle(
              color: AppColors.textPrimary, fontWeight: FontWeight.bold, fontSize: 18)),
        ]),
        const Spacer(),
        Icon(rec == 'BUY' ? Icons.trending_up :
             rec == 'SELL' ? Icons.trending_down : Icons.trending_flat,
             color: color, size: 32),
      ]),
    );
  }
}

class _RecommendationCard extends StatelessWidget {
  final AssetRecommendation rec;
  const _RecommendationCard({required this.rec});

  @override
  Widget build(BuildContext context) {
    final color = rec.recommendation == 'BUY' ? AppColors.buy
        : rec.recommendation == 'SELL' ? AppColors.sell
        : AppColors.hold;
    final label = rec.baseAsset;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(label, style: const TextStyle(
              color: AppColors.textPrimary, fontWeight: FontWeight.bold, fontSize: 15)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: color.withAlpha(30),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(rec.recommendation,
                style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
          ),
        ]),
        const SizedBox(height: 8),
        // Confidence bar
        Row(children: [
          Expanded(child: ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: rec.confidence / 100,
              minHeight: 6,
              color: color,
              backgroundColor: AppColors.border,
            ),
          )),
          const SizedBox(width: 8),
          Text('${rec.confidence}%',
              style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold)),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          const Icon(Icons.trending_up, size: 13, color: AppColors.textMuted),
          const SizedBox(width: 4),
          Text('Expected ±${rec.expectedMovePercent.toStringAsFixed(1)}%',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
          const Spacer(),
          Text(rec.trend,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
        ]),
        if (rec.reason.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(rec.reason,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
              maxLines: 2, overflow: TextOverflow.ellipsis),
        ],
      ]),
    );
  }
}

class _SimAssetCard extends StatelessWidget {
  final AssetRecommendation rec;
  const _SimAssetCard({required this.rec});

  @override
  Widget build(BuildContext context) {
    final rp    = rec.returnPct ?? 0;
    final color = rp >= 0 ? AppColors.buy : AppColors.sell;
    final sign  = rp >= 0 ? '+' : '';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(rec.baseAsset, style: const TextStyle(
              color: AppColors.textPrimary, fontWeight: FontWeight.bold)),
          if (rec.trades != null)
            Text('${rec.trades} trades',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
        ])),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('$sign\$${(rec.profit ?? 0).toStringAsFixed(2)}',
              style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 14)),
          Text('$sign${rp.toStringAsFixed(2)}%',
              style: TextStyle(color: color, fontSize: 12)),
        ]),
      ]),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  final bool   fullWidth;
  const _StatCard({required this.label, required this.value,
      required this.color, this.fullWidth = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: fullWidth ? double.infinity : null,
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
      decoration: BoxDecoration(
        color: color.withAlpha(20),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withAlpha(50)),
      ),
      child: Column(children: [
        Text(value, style: TextStyle(
            color: color, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(
            color: AppColors.textMuted, fontSize: 10)),
      ]),
    );
  }
}

// ─── Order Blocks tab ─────────────────────────────────────────────────────────

class _OrderBlocksTab extends ConsumerWidget {
  const _OrderBlocksTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final obAsync = ref.watch(orderBlockProvider);
    final form    = ref.watch(obFormProvider);
    final screenW = MediaQuery.sizeOf(context).width;

    return SizedBox(
      width: screenW,
      child: Column(children: [
      // ── OB config bar ──────────────────────────────────────────────────────
      Container(
        color: AppColors.card,
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(children: [
          // Asset dropdown — fixed width so Row works under any constraints
          SizedBox(
            width: 96,
            child: _OBAssetDropdown(
              current: form.asset,
              onChanged: (v) => ref.read(obFormProvider.notifier).state =
                  form.copyWith(asset: v),
            ),
          ),
          const SizedBox(width: 10),
          _OBTimeframeSelector(
            current: form.timeframe,
            onChanged: (v) => ref.read(obFormProvider.notifier).state =
                form.copyWith(timeframe: v),
          ),
          const Spacer(),
          SizedBox(
            width: 68,
            height: 38,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                padding: EdgeInsets.zero,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onPressed: () => ref.read(orderBlockProvider.notifier).analyze(),
              child: const Text('Scan', style: TextStyle(fontSize: 13)),
            ),
          ),
        ]),
      ),

      // ── Results ────────────────────────────────────────────────────────────
      Expanded(
        child: obAsync.when(
          data: (result) {
            if (result == null) {
              return const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.layers_outlined, size: 44, color: AppColors.textMuted),
                SizedBox(height: 10),
                Text('Detect Order Blocks',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary)),
                SizedBox(height: 6),
                Text('Select asset & timeframe,\nthen tap Scan.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              ]));
            }
            return _OBResult(result: result);
          },
          loading: () => const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircularProgressIndicator(color: AppColors.primary),
            SizedBox(height: 16),
            Text('Scanning for order blocks…',
                style: TextStyle(color: AppColors.textSecondary)),
          ])),
          error: (e, _) => _ErrorView(
            message: e.toString(),
            onRetry: () => ref.read(orderBlockProvider.notifier).analyze(),
          ),
        ),
      ),
    ]),
    );
  }
}

class _OBAssetDropdown extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;
  const _OBAssetDropdown({required this.current, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: current,
          isExpanded: true,
          dropdownColor: AppColors.card,
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
          isDense: true,
          onChanged: (v) { if (v != null) onChanged(v); },
          items: kTrackedAssets.map((a) => DropdownMenuItem(
            value: a,
            child: Text(a.replaceAll('USDT', '')),
          )).toList(),
        ),
      ),
    );
  }
}

class _OBTimeframeSelector extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;
  const _OBTimeframeSelector({required this.current, required this.onChanged});

  static const _opts = [('15m','15m'), ('1H','1h'), ('4H','4h'), ('1D','1d')];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: _opts.map((o) {
        final sel = current == o.$2;
        return GestureDetector(
          onTap: () => onChanged(o.$2),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: sel ? AppColors.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(5),
            ),
            child: Text(o.$1,
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: sel ? FontWeight.bold : FontWeight.normal,
                    color: sel ? Colors.white : AppColors.textSecondary)),
          ),
        );
      }).toList()),
    );
  }
}

class _OBResult extends StatelessWidget {
  final OrderBlockResult result;
  const _OBResult({required this.result});

  @override
  Widget build(BuildContext context) {
    final sig      = result.signal;
    final sigColor = sig.action == 'BUY' ? AppColors.buy
        : sig.action == 'SELL' ? AppColors.sell
        : AppColors.hold;

    return ListView(padding: const EdgeInsets.all(16), children: [
      // ── Signal card ──────────────────────────────────────────────────────
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: sigColor.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: sigColor.withValues(alpha: 0.3)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(
                color: sigColor.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(sig.action,
                  style: TextStyle(color: sigColor,
                      fontWeight: FontWeight.bold, fontSize: 14)),
            ),
            const SizedBox(width: 10),
            Text('${result.asset.replaceAll('USDT', '')} · ${result.timeframe.toUpperCase()}',
                style: const TextStyle(color: AppColors.textPrimary,
                    fontWeight: FontWeight.bold, fontSize: 15)),
            const Spacer(),
            Text('${sig.confidence}%',
                style: TextStyle(color: sigColor,
                    fontWeight: FontWeight.bold, fontSize: 16)),
          ]),
          const SizedBox(height: 10),
          // Confidence bar
          SizedBox(width: double.infinity, child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: sig.confidence / 100,
              minHeight: 5,
              color: sigColor,
              backgroundColor: AppColors.border,
            ),
          )),
          const SizedBox(height: 10),
          if (sig.entryZone != null) ...[
            _SigRow('Entry Zone', sig.entryZone!, sigColor),
            const SizedBox(height: 4),
            _SigRow('Stop Loss',  sig.stopLoss?.toStringAsFixed(4) ?? '—', AppColors.sell),
            const SizedBox(height: 4),
            _SigRow('Take Profit', sig.takeProfit?.toStringAsFixed(4) ?? '—', AppColors.buy),
            if (sig.riskReward != null) ...[
              const SizedBox(height: 4),
              _SigRow('Risk/Reward', sig.riskReward!, AppColors.primary),
            ],
            const SizedBox(height: 8),
          ],
          Text(sig.reason,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ]),
      ),
      const SizedBox(height: 12),

      // ── Market context ───────────────────────────────────────────────────
      Row(children: [
        Expanded(child: _StatCard(label: 'Price',
            value: '\$${result.currentPrice.toStringAsFixed(2)}',
            color: AppColors.textPrimary)),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(label: 'RSI',
            value: result.rsi.toStringAsFixed(1),
            color: result.rsi > 70 ? AppColors.sell
                : result.rsi < 30 ? AppColors.buy : AppColors.primary)),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
            label: 'Trend',
            value: result.trend.substring(0, 1).toUpperCase() + result.trend.substring(1),
            color: result.trend == 'bullish' ? AppColors.buy
                : result.trend == 'bearish' ? AppColors.sell : AppColors.hold)),
      ]),
      const SizedBox(height: 16),

      // ── News & social sentiment card ─────────────────────────────────────
      _OBNewsCard(news: result.newsAnalysis),
      const SizedBox(height: 16),

      // ── Order blocks list ────────────────────────────────────────────────
      Text('${result.orderBlocks.length} Order Blocks Detected',
          style: const TextStyle(color: AppColors.textSecondary,
              fontSize: 12, fontWeight: FontWeight.w500)),
      const SizedBox(height: 8),
      ...result.orderBlocks.map((ob) => _OBCard(ob: ob, currentPrice: result.currentPrice)),
    ]);
  }
}

class _SigRow extends StatelessWidget {
  final String label, value;
  final Color color;
  const _SigRow(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Text('$label: ', style: const TextStyle(
          color: AppColors.textMuted, fontSize: 12)),
      Text(value, style: TextStyle(
          color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    ]);
  }
}

class _OBCard extends StatelessWidget {
  final OrderBlock ob;
  final double     currentPrice;
  const _OBCard({required this.ob, required this.currentPrice});

  @override
  Widget build(BuildContext context) {
    final color    = ob.isBullish ? AppColors.buy : AppColors.sell;
    final midZone  = (ob.zone.low + ob.zone.high) / 2;
    final distPct  = ((currentPrice - midZone) / midZone * 100).abs();
    final fresh    = ob.freshness == 'fresh';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(children: [
        // Type indicator
        Container(
          width: 4, height: 44,
          decoration: BoxDecoration(
            color: color, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(ob.isBullish ? 'Bullish OB' : 'Bearish OB',
                style: TextStyle(color: color,
                    fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: fresh
                    ? AppColors.buy.withValues(alpha: 0.12)
                    : AppColors.hold.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(ob.freshness,
                  style: TextStyle(
                      fontSize: 10,
                      color: fresh ? AppColors.buy : AppColors.hold,
                      fontWeight: FontWeight.w600)),
            ),
          ]),
          const SizedBox(height: 3),
          Text('\$${ob.zone.low.toStringAsFixed(4)} – \$${ob.zone.high.toStringAsFixed(4)}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          Text('${distPct.toStringAsFixed(2)}% from price',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
        ])),
        // Strength meter
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${ob.strength}',
              style: TextStyle(color: color,
                  fontWeight: FontWeight.bold, fontSize: 18)),
          const Text('str', style: TextStyle(
              color: AppColors.textMuted, fontSize: 10)),
          const SizedBox(height: 4),
          SizedBox(width: 36, child: ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: ob.strength / 100,
              minHeight: 4,
              color: color,
              backgroundColor: AppColors.border,
            ),
          )),
        ]),
      ]),
    );
  }
}

class _OBNewsCard extends StatelessWidget {
  final OBNewsAnalysis news;
  const _OBNewsCard({required this.news});

  @override
  Widget build(BuildContext context) {
    final score   = news.combinedScore;
    final isBull  = news.sentiment == 'bullish';
    final isBear  = news.sentiment == 'bearish';
    final sentColor = isBull ? AppColors.buy : isBear ? AppColors.sell : AppColors.hold;
    final boostAbs  = news.confidenceBoost.abs();
    final boostSign = news.confidenceBoost >= 0 ? '+' : '';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Header
        Row(children: [
          const Icon(Icons.newspaper_rounded, size: 14, color: AppColors.textMuted),
          const SizedBox(width: 6),
          const Text('News & Social Fusion',
              style: TextStyle(color: AppColors.textPrimary,
                  fontWeight: FontWeight.w600, fontSize: 13)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: sentColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              news.sentiment[0].toUpperCase() + news.sentiment.substring(1),
              style: TextStyle(color: sentColor, fontSize: 11,
                  fontWeight: FontWeight.bold),
            ),
          ),
        ]),
        const SizedBox(height: 10),

        // Combined sentiment bar
        Row(children: [
          const Text('Market Mood', style: TextStyle(
              color: AppColors.textMuted, fontSize: 11)),
          const Spacer(),
          Text('${score.toStringAsFixed(0)}/100',
              style: TextStyle(color: sentColor,
                  fontSize: 11, fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 4),
        SizedBox(width: double.infinity, child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: score / 100,
            minHeight: 6,
            color: sentColor,
            backgroundColor: AppColors.border,
          ),
        )),
        const SizedBox(height: 10),

        // Stats row
        Row(children: [
          _OBNewsStat(
            label: 'News',
            value: news.newsScore.toStringAsFixed(0),
            color: AppColors.textSecondary,
          ),
          const SizedBox(width: 8),
          _OBNewsStat(
            label: 'Social',
            value: news.socialScore.toStringAsFixed(0),
            color: AppColors.textSecondary,
          ),
          const SizedBox(width: 8),
          _OBNewsStat(
            label: 'Articles',
            value: '${news.articleCount}',
            color: AppColors.textSecondary,
          ),
          const Spacer(),
          // Confidence boost badge
          if (boostAbs > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: (news.confidenceBoost >= 0 ? AppColors.buy : AppColors.sell)
                    .withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                '$boostSign${news.confidenceBoost}% conf',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: news.confidenceBoost >= 0 ? AppColors.buy : AppColors.sell,
                ),
              ),
            ),
        ]),

        // Technical vs fused confidence
        if (news.technicalConfidence != 0) ...[
          const SizedBox(height: 6),
          Text(
            'Technical: ${news.technicalConfidence}%  →  Fused: ${news.technicalConfidence + news.confidenceBoost}%  '
            '(60% OB + 40% sentiment)',
            style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
          ),
        ],

        // Top events
        if (news.topEvents.isNotEmpty) ...[
          const SizedBox(height: 8),
          ...news.topEvents.map((e) => Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('• ', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
              Expanded(child: Text(e,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                  maxLines: 1, overflow: TextOverflow.ellipsis)),
            ]),
          )),
        ],
      ]),
    );
  }
}

class _OBNewsStat extends StatelessWidget {
  final String label, value;
  final Color color;
  const _OBNewsStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Text(value, style: TextStyle(
          color: color, fontWeight: FontWeight.bold, fontSize: 13)),
      Text(label, style: const TextStyle(
          color: AppColors.textMuted, fontSize: 10)),
    ]);
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.cloud_off, size: 48, color: AppColors.textMuted),
      const SizedBox(height: 12),
      Text(message,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
          textAlign: TextAlign.center, maxLines: 3, overflow: TextOverflow.ellipsis),
      const SizedBox(height: 16),
      ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
    ]));
  }
}
