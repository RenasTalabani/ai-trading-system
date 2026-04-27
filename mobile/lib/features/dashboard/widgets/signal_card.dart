import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/models/signal_model.dart';
import '../../../core/theme/app_theme.dart';

class SignalCard extends StatelessWidget {
  final SignalModel signal;
  final bool compact;

  const SignalCard({super.key, required this.signal, this.compact = false});

  Color get _dirColor {
    if (signal.isBuy)  return AppColors.buy;
    if (signal.isSell) return AppColors.sell;
    return AppColors.hold;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/signals/${signal.id}'),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: _dirColor.withValues(alpha: 0.08),
              blurRadius: 12,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(children: [
          // Direction indicator bar
          Container(
            height: 3,
            decoration: BoxDecoration(
              color: _dirColor,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              _Header(signal: signal, dirColor: _dirColor),
              const SizedBox(height: 12),
              _ConfidenceBar(confidence: signal.confidence, color: _dirColor),
              if (!compact) ...[
                const SizedBox(height: 12),
                _PriceRow(signal: signal),
                const SizedBox(height: 12),
                _SourcesRow(sources: signal.sources),
              ],
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final SignalModel signal;
  final Color dirColor;
  const _Header({required this.signal, required this.dirColor});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      // Asset icon placeholder
      Container(
        width: 40, height: 40,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Center(
          child: Text(
            signal.baseAsset.substring(0, signal.baseAsset.length.clamp(0, 3)),
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
          ),
        ),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(signal.asset,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: AppColors.textPrimary)),
          Text(DateFormat('MMM d, HH:mm').format(signal.createdAt),
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ],
      )),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: dirColor.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: dirColor.withValues(alpha: 0.4)),
        ),
        child: Text(
          signal.direction,
          style: TextStyle(color: dirColor, fontWeight: FontWeight.bold, fontSize: 13),
        ),
      ),
    ]);
  }
}

class _ConfidenceBar extends StatelessWidget {
  final double confidence;
  final Color color;
  const _ConfidenceBar({required this.confidence, required this.color});

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        const Text('Confidence', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        Text('${confidence.toStringAsFixed(0)}%',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
      ]),
      const SizedBox(height: 6),
      ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(
          value: confidence / 100,
          backgroundColor: AppColors.surface,
          valueColor: AlwaysStoppedAnimation(color),
          minHeight: 6,
        ),
      ),
    ]);
  }
}

class _PriceRow extends StatelessWidget {
  final SignalModel signal;
  const _PriceRow({required this.signal});

  @override
  Widget build(BuildContext context) {
    final fmt = NumberFormat('#,##0.##');
    return Row(children: [
      _PriceTile(label: 'Entry',  value: '\$${fmt.format(signal.price.entry)}', color: AppColors.textPrimary),
      const SizedBox(width: 8),
      if (signal.price.stopLoss != null)
        _PriceTile(label: 'Stop Loss',   value: '\$${fmt.format(signal.price.stopLoss!)}',   color: AppColors.sell),
      if (signal.price.stopLoss != null) const SizedBox(width: 8),
      if (signal.price.takeProfit != null)
        _PriceTile(label: 'Take Profit', value: '\$${fmt.format(signal.price.takeProfit!)}', color: AppColors.buy),
    ]);
  }
}

class _PriceTile extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _PriceTile({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
      ]),
    ));
  }
}

class _SourcesRow extends StatelessWidget {
  final SignalSources sources;
  const _SourcesRow({required this.sources});

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      _SourceChip(label: 'Market',  value: sources.marketScore),
      const SizedBox(width: 6),
      _SourceChip(label: 'News',    value: sources.newsScore),
      const SizedBox(width: 6),
      _SourceChip(label: 'Social',  value: sources.socialScore),
    ]);
  }
}

class _SourceChip extends StatelessWidget {
  final String label;
  final double value;
  const _SourceChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Container(
      padding: const EdgeInsets.symmetric(vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(children: [
        Text(label, style: const TextStyle(fontSize: 9, color: AppColors.textMuted)),
        Text('${value.toStringAsFixed(0)}%',
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
      ]),
    ));
  }
}
