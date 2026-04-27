import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/models/signal_model.dart';
import '../../core/providers/signals_provider.dart';
import '../../core/theme/app_theme.dart';

class SignalDetailScreen extends ConsumerWidget {
  final String signalId;
  const SignalDetailScreen({super.key, required this.signalId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signals = ref.watch(signalsProvider).signals;
    final signal = signals.where((s) => s.id == signalId).firstOrNull;

    if (signal == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Signal')),
        body: const Center(child: Text('Signal not found', style: TextStyle(color: AppColors.textSecondary))),
      );
    }

    return _DetailView(signal: signal);
  }
}

class _DetailView extends StatelessWidget {
  final SignalModel signal;
  const _DetailView({required this.signal});

  Color get _dirColor => signal.isBuy ? AppColors.buy : signal.isSell ? AppColors.sell : AppColors.hold;

  @override
  Widget build(BuildContext context) {
    final fmt  = NumberFormat('#,##0.####');
    final date = DateFormat('MMM d, yyyy HH:mm').format(signal.createdAt);

    return Scaffold(
      appBar: AppBar(
        title: Text(signal.asset),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 16),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: _dirColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _dirColor.withValues(alpha: 0.4)),
            ),
            child: Text(signal.direction,
                style: TextStyle(color: _dirColor, fontWeight: FontWeight.bold, fontSize: 13)),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [

          // Confidence circle
          Center(child: _ConfidenceCircle(confidence: signal.confidence, color: _dirColor)),
          const SizedBox(height: 24),

          // Price levels
          _Section(title: 'Price Levels', child: Column(children: [
            _PriceRow(label: 'Entry Price',  value: '\$${fmt.format(signal.price.entry)}',   color: AppColors.textPrimary),
            if (signal.price.stopLoss != null)
              _PriceRow(label: 'Stop Loss',    value: '\$${fmt.format(signal.price.stopLoss!)}',   color: AppColors.sell),
            if (signal.price.takeProfit != null)
              _PriceRow(label: 'Take Profit',  value: '\$${fmt.format(signal.price.takeProfit!)}', color: AppColors.buy),
            if (signal.price.riskRewardRatio != null)
              _PriceRow(label: 'Risk / Reward',
                  value: '1 : ${signal.price.riskRewardRatio!.toStringAsFixed(2)}',
                  color: AppColors.primary),
          ])),

          const SizedBox(height: 16),

          // Sources breakdown
          _Section(title: 'Intelligence Sources', child: Column(children: [
            _SourceBar(label: 'Market Analysis',    value: signal.sources.marketScore, color: AppColors.primary),
            const SizedBox(height: 10),
            _SourceBar(label: 'News Sentiment',     value: signal.sources.newsScore,   color: AppColors.hold),
            const SizedBox(height: 10),
            _SourceBar(label: 'Social Intelligence', value: signal.sources.socialScore, color: AppColors.buy),
          ])),

          const SizedBox(height: 16),

          // Reason
          _Section(title: 'AI Reasoning', child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(signal.reason,
                style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.5)),
          )),

          const SizedBox(height: 16),

          // Metadata
          _Section(title: 'Details', child: Column(children: [
            _PriceRow(label: 'Generated',    value: date,           color: AppColors.textSecondary),
            _PriceRow(label: 'Status',       value: signal.status.toUpperCase(), color: AppColors.textSecondary),
            _PriceRow(label: 'Confidence',   value: '${signal.confidence.toStringAsFixed(1)}%', color: _dirColor),
          ])),

          const SizedBox(height: 32),
        ]),
      ),
    );
  }
}

class _ConfidenceCircle extends StatelessWidget {
  final double confidence;
  final Color color;
  const _ConfidenceCircle({required this.confidence, required this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 130, height: 130,
      child: Stack(alignment: Alignment.center, children: [
        CircularProgressIndicator(
          value: confidence / 100,
          strokeWidth: 10,
          backgroundColor: AppColors.surface,
          valueColor: AlwaysStoppedAnimation(color),
        ),
        Column(mainAxisSize: MainAxisSize.min, children: [
          Text('${confidence.toStringAsFixed(0)}%',
              style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: color)),
          const Text('confidence', style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ]),
      ]),
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final Widget child;
  const _Section({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
          color: AppColors.textMuted, letterSpacing: 0.5)),
      const SizedBox(height: 10),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: child,
      ),
    ]);
  }
}

class _PriceRow extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _PriceRow({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
        Text(value,  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color)),
      ]),
    );
  }
}

class _SourceBar extends StatelessWidget {
  final String label;
  final double value;
  final Color color;
  const _SourceBar({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        Text('${value.toStringAsFixed(0)}%',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
      ]),
      const SizedBox(height: 5),
      ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(
          value: (value / 100).clamp(0.0, 1.0),
          backgroundColor: AppColors.surface,
          valueColor: AlwaysStoppedAnimation(color),
          minHeight: 5,
        ),
      ),
    ]);
  }
}
