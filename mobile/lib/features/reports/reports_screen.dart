import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/reports_provider.dart';
import '../../core/theme/app_theme.dart';

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});
  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(reportsProvider.notifier).fetchLatest();
      ref.read(reportsProvider.notifier).fetchHistory();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(reportsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Reports'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(reportsProvider.notifier).fetchLatest();
              ref.read(reportsProvider.notifier).fetchHistory();
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          labelColor: AppColors.primary,
          unselectedLabelColor: AppColors.textMuted,
          indicatorColor: AppColors.primary,
          tabs: const [
            Tab(text: 'Latest'),
            Tab(text: 'History'),
          ],
        ),
      ),
      body: state.loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : TabBarView(
              controller: _tabs,
              children: [
                _LatestTab(state: state),
                _HistoryTab(state: state),
              ],
            ),
    );
  }
}

// ── Latest report ─────────────────────────────────────────────────────────────

class _LatestTab extends StatelessWidget {
  final ReportsState state;
  const _LatestTab({required this.state});

  @override
  Widget build(BuildContext context) {
    if (state.error != null) {
      return Center(child: Text(state.error!,
          style: const TextStyle(color: AppColors.textSecondary)));
    }
    if (state.latest == null) {
      return const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.article_outlined, size: 48, color: AppColors.textMuted),
        SizedBox(height: 12),
        Text('No reports yet', style: TextStyle(color: AppColors.textSecondary)),
        SizedBox(height: 6),
        Text('Reports are generated every hour automatically.',
            style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
      ]));
    }
    return _ReportDetail(report: state.latest!);
  }
}

class _ReportDetail extends StatelessWidget {
  final AIReport report;
  const _ReportDetail({required this.report});

  @override
  Widget build(BuildContext context) {
    final moodColor = report.marketMood == 'bullish'
        ? AppColors.buy
        : report.marketMood == 'bearish'
            ? AppColors.sell
            : AppColors.hold;

    final actionColor = report.topAction == 'BUY'
        ? AppColors.buy
        : report.topAction == 'SELL'
            ? AppColors.sell
            : AppColors.hold;

    final portfolioColor =
        report.portfolioChange >= 0 ? AppColors.buy : AppColors.sell;
    final portSign = report.portfolioChange >= 0 ? '+' : '';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Timestamp
        Text(_formatTime(report.createdAt),
            style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
        const SizedBox(height: 12),

        // AI Insight
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.psychology, color: AppColors.primary, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Text(report.aiInsight,
                    style: const TextStyle(
                        color: AppColors.textPrimary, fontSize: 14, height: 1.5)),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 12),

        // Market Mood
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Market Mood',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
              const SizedBox(height: 10),
              Row(children: [
                Icon(
                  report.marketMood == 'bullish'
                      ? Icons.trending_up
                      : report.marketMood == 'bearish'
                          ? Icons.trending_down
                          : Icons.trending_flat,
                  color: moodColor, size: 28,
                ),
                const SizedBox(width: 12),
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(report.marketMood.toUpperCase(),
                      style: TextStyle(color: moodColor,
                          fontWeight: FontWeight.bold, fontSize: 18)),
                  Text('${report.moodPct}% agreement · ${report.activeSignals} active signals',
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                ]),
              ]),
              const SizedBox(height: 10),
              LinearProgressIndicator(
                value: report.moodPct / 100,
                color: moodColor,
                backgroundColor: AppColors.surface,
                minHeight: 6,
                borderRadius: BorderRadius.circular(4),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 10),

        // Top Signal
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Top Signal',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                Text(report.topAsset,
                    style: const TextStyle(color: AppColors.textPrimary,
                        fontWeight: FontWeight.bold, fontSize: 18)),
              ])),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: actionColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: actionColor.withValues(alpha: 0.4)),
                  ),
                  child: Text(report.topAction,
                      style: TextStyle(color: actionColor, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(height: 4),
                Text('${report.topConfidence.toStringAsFixed(0)}% confidence',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
              ]),
            ]),
          ),
        ),
        const SizedBox(height: 10),

        // Best Opportunity
        if (report.bestAsset != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Best Opportunity',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 8),
                Row(children: [
                  Text(report.bestAsset!,
                      style: const TextStyle(color: AppColors.textPrimary,
                          fontWeight: FontWeight.w600, fontSize: 16)),
                  const SizedBox(width: 10),
                  if (report.bestAction != null)
                    _Pill(
                      label: report.bestAction!,
                      color: report.bestAction == 'BUY'
                          ? AppColors.buy
                          : report.bestAction == 'SELL'
                              ? AppColors.sell
                              : AppColors.hold,
                    ),
                  if (report.bestConfidence != null) ...[
                    const SizedBox(width: 8),
                    Text('${report.bestConfidence!.toStringAsFixed(0)}%',
                        style: const TextStyle(color: AppColors.primary, fontSize: 13)),
                  ],
                ]),
                if (report.bestReason != null && report.bestReason!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(report.bestReason!,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ]),
            ),
          ),
        const SizedBox(height: 10),

        // Portfolio
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Portfolio',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 6),
                Text('\$${report.portfolioBalance.toStringAsFixed(2)}',
                    style: const TextStyle(color: AppColors.textPrimary,
                        fontWeight: FontWeight.bold, fontSize: 18)),
              ])),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('$portSign\$${report.portfolioChange.toStringAsFixed(2)}',
                    style: TextStyle(color: portfolioColor,
                        fontWeight: FontWeight.bold, fontSize: 16)),
                Text('${report.openTrades} open trades',
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
              ]),
            ]),
          ),
        ),
      ],
    );
  }
}

// ── History tab ───────────────────────────────────────────────────────────────

class _HistoryTab extends StatelessWidget {
  final ReportsState state;
  const _HistoryTab({required this.state});

  @override
  Widget build(BuildContext context) {
    if (state.history.isEmpty) {
      return const Center(child: Text('No report history yet.',
          style: TextStyle(color: AppColors.textSecondary)));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: state.history.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) => _HistoryRow(report: state.history[i]),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final AIReport report;
  const _HistoryRow({required this.report});

  @override
  Widget build(BuildContext context) {
    final moodColor = report.marketMood == 'bullish'
        ? AppColors.buy
        : report.marketMood == 'bearish'
            ? AppColors.sell
            : AppColors.hold;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(children: [
          Icon(
            report.marketMood == 'bullish'
                ? Icons.trending_up
                : report.marketMood == 'bearish'
                    ? Icons.trending_down
                    : Icons.trending_flat,
            color: moodColor, size: 22,
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(report.aiInsight,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 4),
            Text(_formatTime(report.createdAt),
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          ])),
          const SizedBox(width: 8),
          _Pill(label: report.topAsset.replaceAll('USDT', ''), color: moodColor),
        ]),
      ),
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

class _Pill extends StatelessWidget {
  final String label;
  final Color color;
  const _Pill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(label,
            style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
      );
}

String _formatTime(DateTime dt) {
  final local = dt.toLocal();
  return '${local.day}/${local.month} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}
