import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/core_provider.dart';
import '../../core/theme/app_theme.dart';

final _capitalProvider = StateProvider<double>((ref) => 500.0);

class FollowedAIScreen extends ConsumerWidget {
  const FollowedAIScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final capital = ref.watch(_capitalProvider);
    final async   = ref.watch(coreSimProvider(capital));

    return Scaffold(
      appBar: AppBar(
        title: const Text('If You Followed AI'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.refresh(coreSimProvider(capital)),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          _CapitalSelector(capital: capital),
          const SizedBox(height: 16),
          async.when(
            loading: () => const _LoadingCard(),
            error:   (e, _) => _ErrorCard(
              message: e.toString(),
              onRetry: () => ref.refresh(coreSimProvider(capital)),
            ),
            data:    (result) => _ResultView(result: result),
          ),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }
}

// ── Capital selector ──────────────────────────────────────────────────────────

class _CapitalSelector extends ConsumerWidget {
  final double capital;
  const _CapitalSelector({required this.capital});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Starting Capital',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [100, 500, 1000, 5000].map((v) {
              final selected = capital == v.toDouble();
              return GestureDetector(
                onTap: () => ref.read(_capitalProvider.notifier).state = v.toDouble(),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.primary.withValues(alpha: 0.2)
                        : AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: selected ? AppColors.primary : AppColors.border),
                  ),
                  child: Text('\$$v',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: selected ? FontWeight.w700 : FontWeight.normal,
                        color: selected ? AppColors.primary : AppColors.textSecondary,
                      )),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

// ── Result view ───────────────────────────────────────────────────────────────

class _ResultView extends StatelessWidget {
  final CoreSimResult result;
  const _ResultView({required this.result});

  @override
  Widget build(BuildContext context) {
    if (result.message != null && result.totalTrades == 0) {
      return _EmptyCard(message: result.message!);
    }

    final profitPositive = result.profit >= 0;
    final profitColor    = profitPositive ? AppColors.buy : AppColors.sell;

    return Column(children: [
      // Hero balance card
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: profitColor.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: profitColor.withValues(alpha: 0.4), width: 1.5),
        ),
        child: Column(children: [
          const Text('Your Balance Would Be',
              style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Text('\$${result.balance.toStringAsFixed(2)}',
              style: TextStyle(
                  fontSize: 36, fontWeight: FontWeight.w900, color: profitColor)),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: profitColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              '${profitPositive ? '+' : ''}\$${result.profit.toStringAsFixed(2)} '
              '(${profitPositive ? '+' : ''}${result.profitPercent.toStringAsFixed(1)}%)',
              style: TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w700, color: profitColor),
            ),
          ),
          const SizedBox(height: 4),
          Text('starting from \$${result.capital.toStringAsFixed(0)}',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ]),
      ),

      const SizedBox(height: 12),

      // Stats row
      Row(children: [
        _StatBox(
          label: 'Win Rate',
          value: '${result.winRate}%',
          color: result.winRate >= 50 ? AppColors.buy : AppColors.sell,
        ),
        const SizedBox(width: 8),
        _StatBox(
          label: 'Total Trades',
          value: '${result.totalTrades}',
          color: AppColors.primary,
        ),
        const SizedBox(width: 8),
        _StatBox(
          label: 'Wins / Losses',
          value: '${result.wins} / ${result.losses}',
          color: AppColors.textPrimary,
        ),
      ]),
    ]);
  }
}

class _StatBox extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _StatBox({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Column(children: [
          Text(value,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
          const SizedBox(height: 3),
          Text(label,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 10, color: AppColors.textSecondary)),
        ]),
      ),
    );
  }
}

// ── Helper widgets ────────────────────────────────────────────────────────────

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();
  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 160,
    child: Center(child: CircularProgressIndicator(color: AppColors.primary)),
  );
}

class _EmptyCard extends StatelessWidget {
  final String message;
  const _EmptyCard({required this.message});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(children: [
      const Icon(Icons.hourglass_top, size: 40, color: AppColors.textMuted),
      const SizedBox(height: 12),
      Text(message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary)),
    ]),
  );
}

class _ErrorCard extends StatelessWidget {
  final String       message;
  final VoidCallback onRetry;
  const _ErrorCard({required this.message, required this.onRetry});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.sell.withValues(alpha: 0.3)),
    ),
    child: Column(children: [
      const Icon(Icons.error_outline, size: 36, color: AppColors.sell),
      const SizedBox(height: 10),
      Text(message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary)),
      const SizedBox(height: 14),
      TextButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
        label: const Text('Retry'),
      ),
    ]),
  );
}
