import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/simulator_provider.dart';
import '../../core/theme/app_theme.dart';

const _kAllAssets = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
];

class SimulatorScreen extends ConsumerStatefulWidget {
  const SimulatorScreen({super.key});
  @override
  ConsumerState<SimulatorScreen> createState() => _SimulatorScreenState();
}

class _SimulatorScreenState extends ConsumerState<SimulatorScreen> {
  final _capitalCtrl = TextEditingController(text: '500');

  @override
  void dispose() {
    _capitalCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final form  = ref.watch(simulatorFormProvider);
    final state = ref.watch(simulatorProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Budget Simulator'),
        actions: [
          if (state.result != null)
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => ref.read(simulatorProvider.notifier).reset(),
            ),
        ],
      ),
      body: state.result != null
          ? _ResultView(result: state.result!, onReset: () => ref.read(simulatorProvider.notifier).reset())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _ConfigCard(capitalCtrl: _capitalCtrl, form: form),
                const SizedBox(height: 12),
                if (state.loading)
                  const Center(child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      CircularProgressIndicator(color: AppColors.primary),
                      SizedBox(height: 16),
                      Text('Running simulation on real market data...',
                          style: TextStyle(color: AppColors.textSecondary)),
                    ]),
                  )),
                if (state.error != null)
                  Card(child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(state.error!, style: const TextStyle(color: AppColors.error)),
                  )),
                if (!state.loading)
                  ElevatedButton.icon(
                    onPressed: () {
                      final cap = double.tryParse(_capitalCtrl.text) ?? 500;
                      ref.read(simulatorProvider.notifier).run(
                        capital:      cap,
                        assets:       form.assets,
                        durationDays: form.durationDays,
                        riskPct:      form.riskPct,
                      );
                    },
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Run Simulation'),
                  ),
              ],
            ),
    );
  }
}

// ── Config form ───────────────────────────────────────────────────────────────

class _ConfigCard extends ConsumerWidget {
  final TextEditingController capitalCtrl;
  final SimulatorFormState form;
  const _ConfigCard({required this.capitalCtrl, required this.form});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Capital (\$)', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            TextField(
              controller: capitalCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(hintText: '500', prefixText: '\$ '),
            ),
            const SizedBox(height: 16),
            Text('Assets', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: _kAllAssets.map((a) {
                final selected = form.assets.contains(a);
                return FilterChip(
                  label: Text(a.replaceAll('USDT', ''), style: const TextStyle(fontSize: 12)),
                  selected: selected,
                  onSelected: (on) {
                    final list = List<String>.from(form.assets);
                    on ? list.add(a) : list.remove(a);
                    if (list.isNotEmpty) {
                      ref.read(simulatorFormProvider.notifier)
                          .update((s) => s.copyWith(assets: list));
                    }
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Duration: ${form.durationDays} days',
                    style: Theme.of(context).textTheme.labelLarge),
                Slider(
                  value: form.durationDays.toDouble(),
                  min: 1, max: 30,
                  divisions: 29,
                  label: '${form.durationDays}d',
                  activeColor: AppColors.primary,
                  onChanged: (v) => ref.read(simulatorFormProvider.notifier)
                      .update((s) => s.copyWith(durationDays: v.toInt())),
                ),
              ])),
            ]),
            Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Risk per trade: ${form.riskPct.toStringAsFixed(0)}%',
                    style: Theme.of(context).textTheme.labelLarge),
                Slider(
                  value: form.riskPct,
                  min: 1, max: 15,
                  divisions: 14,
                  label: '${form.riskPct.toStringAsFixed(0)}%',
                  activeColor: AppColors.warning,
                  onChanged: (v) => ref.read(simulatorFormProvider.notifier)
                      .update((s) => s.copyWith(riskPct: v)),
                ),
              ])),
            ]),
          ],
        ),
      ),
    );
  }
}

// ── Result view ───────────────────────────────────────────────────────────────

class _ResultView extends StatelessWidget {
  final SimulatorResult result;
  final VoidCallback onReset;
  const _ResultView({required this.result, required this.onReset});

  @override
  Widget build(BuildContext context) {
    final isProfit = result.profit >= 0;
    final profitColor = isProfit ? AppColors.buy : AppColors.sell;
    final sign = isProfit ? '+' : '';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Summary hero card
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(children: [
              Text('Simulation Result', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                _StatCol(label: 'Started', value: '\$${result.capital.toStringAsFixed(0)}',
                    color: AppColors.textPrimary),
                Column(children: [
                  Text('$sign\$${result.profit.toStringAsFixed(2)}',
                      style: TextStyle(color: profitColor, fontSize: 28, fontWeight: FontWeight.bold)),
                  Text('$sign${result.profitPct.toStringAsFixed(2)}%',
                      style: TextStyle(color: profitColor, fontSize: 14)),
                ]),
                _StatCol(label: 'Final', value: '\$${result.finalBalance.toStringAsFixed(2)}',
                    color: profitColor),
              ]),
              const SizedBox(height: 16),
              Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                _StatCol(label: 'Trades',   value: '${result.totalTrades}',  color: AppColors.textPrimary),
                _StatCol(label: 'Win Rate', value: '${result.winRate.toStringAsFixed(0)}%', color: AppColors.primary),
                _StatCol(label: 'Duration', value: '${result.durationDays}d', color: AppColors.textPrimary),
                _StatCol(label: 'Risk/Trade', value: '${result.riskPct.toStringAsFixed(0)}%', color: AppColors.warning),
              ]),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(result.summary,
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                    textAlign: TextAlign.center),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        // Per-asset breakdown
        Text('Per Asset Breakdown', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...result.perAsset.map((a) => _AssetResultCard(asset: a)),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: onReset,
          icon: const Icon(Icons.settings_backup_restore),
          label: const Text('Run New Simulation'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.primary,
            side: const BorderSide(color: AppColors.primary),
            minimumSize: const Size.fromHeight(48),
          ),
        ),
      ],
    );
  }
}

class _AssetResultCard extends StatelessWidget {
  final SimAssetResult asset;
  const _AssetResultCard({required this.asset});

  @override
  Widget build(BuildContext context) {
    final isProfit  = asset.profit >= 0;
    final color     = isProfit ? AppColors.buy : AppColors.sell;
    final sign      = isProfit ? '+' : '';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(asset.asset.replaceAll('USDT', ''),
                style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
            Text('${asset.trades} trades · ${asset.winRate.toStringAsFixed(0)}% win rate',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
          ])),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('$sign\$${asset.profit.toStringAsFixed(2)}',
                style: TextStyle(color: color, fontWeight: FontWeight.bold)),
            Text('$sign${asset.returnPct.toStringAsFixed(2)}%',
                style: TextStyle(color: color, fontSize: 12)),
          ]),
        ]),
      ),
    );
  }
}

class _StatCol extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatCol({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value, style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16)),
        Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
      ]);
}
