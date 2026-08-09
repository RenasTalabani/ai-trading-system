import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/backtest_provider.dart';
import '../../core/providers/watchlist_provider.dart';
import '../../core/theme/app_theme.dart';

class BacktestScreen extends ConsumerStatefulWidget {
  const BacktestScreen({super.key});

  @override
  ConsumerState<BacktestScreen> createState() => _BacktestScreenState();
}

class _BacktestScreenState extends ConsumerState<BacktestScreen> {
  static const _intervals = ['15m', '1h', '4h', '1d'];
  String _asset = 'BTCUSDT';
  String _interval = '1h';
  double _minConfidence = 65;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(backtestProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('AI Model Backtest')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text(
            'Replays the real signal-generation pipeline over historical candles — '
            'see how it would have actually performed before trusting it live.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4),
          ),
          const SizedBox(height: 20),

          const Text('Asset', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: allSupportedAssets.map((a) {
            final selected = a == _asset;
            return ChoiceChip(
              label: Text(displayNameFor(a)),
              selected: selected,
              onSelected: (_) => setState(() => _asset = a),
              selectedColor: AppColors.primary.withValues(alpha: 0.2),
              labelStyle: TextStyle(
                color: selected ? AppColors.primary : AppColors.textSecondary,
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
              ),
            );
          }).toList()),

          const SizedBox(height: 20),
          const Text('Interval', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: _intervals.map((i) {
            final selected = i == _interval;
            return ChoiceChip(
              label: Text(i),
              selected: selected,
              onSelected: (_) => setState(() => _interval = i),
              selectedColor: AppColors.primary.withValues(alpha: 0.2),
              labelStyle: TextStyle(
                color: selected ? AppColors.primary : AppColors.textSecondary,
                fontWeight: selected ? FontWeight.bold : FontWeight.normal,
              ),
            );
          }).toList()),

          const SizedBox(height: 20),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            const Text('Min Confidence', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
            Text('${_minConfidence.toStringAsFixed(0)}%',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.primary)),
          ]),
          Slider(
            value: _minConfidence,
            min: 50, max: 90, divisions: 8,
            activeColor: AppColors.primary,
            onChanged: (v) => setState(() => _minConfidence = v),
          ),

          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: state.loading ? null : () => ref.read(backtestProvider.notifier).run(
                    asset: _asset, interval: _interval, minConfidence: _minConfidence,
                  ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: state.loading
                  ? const SizedBox(width: 20, height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Run Backtest', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ),

          if (state.loading) ...[
            const SizedBox(height: 12),
            const Text('This can take up to a minute — replaying up to 1000 candles.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
          ],

          if (state.error != null) ...[
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.error.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
              ),
              child: Text('Backtest failed: ${state.error}',
                  style: const TextStyle(color: AppColors.error, fontSize: 13)),
            ),
          ],

          if (state.result != null) ...[
            const SizedBox(height: 24),
            _ResultView(result: state.result!),
          ],
        ]),
      ),
    );
  }
}

class _ResultView extends StatelessWidget {
  final dynamic result; // BacktestResultModel
  const _ResultView({required this.result});

  @override
  Widget build(BuildContext context) {
    final positive = result.isProfitable as bool;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: (positive ? AppColors.success : AppColors.error).withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: (positive ? AppColors.success : AppColors.error).withValues(alpha: 0.3)),
        ),
        child: Column(children: [
          Text('${positive ? '+' : ''}${result.totalReturnPct.toStringAsFixed(2)}%',
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold,
                  color: positive ? AppColors.success : AppColors.error)),
          const SizedBox(height: 4),
          Text('${result.totalTrades} trades  •  ${(result.winRate * 100).toStringAsFixed(1)}% win rate',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        ]),
      ),
      const SizedBox(height: 14),
      Row(children: [
        Expanded(child: _StatTile(label: 'Wins', value: '${result.wins}', color: AppColors.success)),
        const SizedBox(width: 10),
        Expanded(child: _StatTile(label: 'Losses', value: '${result.losses}', color: AppColors.error)),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _StatTile(label: 'Profit Factor', value: result.profitFactor.toStringAsFixed(2))),
        const SizedBox(width: 10),
        Expanded(child: _StatTile(label: 'Sharpe Ratio', value: result.sharpeRatio.toStringAsFixed(2))),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _StatTile(label: 'Max Drawdown', value: '${result.maxDrawdownPct.toStringAsFixed(1)}%', color: AppColors.error)),
        const SizedBox(width: 10),
        Expanded(child: _StatTile(label: 'Avg Win / Loss',
            value: '${result.avgWinPct.toStringAsFixed(1)}% / ${result.avgLossPct.toStringAsFixed(1)}%')),
      ]),
    ]);
  }
}

class _StatTile extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  const _StatTile({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
      const SizedBox(height: 4),
      Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold,
          color: color ?? AppColors.textPrimary)),
    ]),
  );
}
