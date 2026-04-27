import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/signals_provider.dart';
import '../../core/theme/app_theme.dart';
import '../dashboard/widgets/signal_card.dart';

class SignalsScreen extends ConsumerStatefulWidget {
  const SignalsScreen({super.key});

  @override
  ConsumerState<SignalsScreen> createState() => _SignalsScreenState();
}

class _SignalsScreenState extends ConsumerState<SignalsScreen> {
  String _filter = 'ALL';

  @override
  Widget build(BuildContext context) {
    final sigState = ref.watch(signalsProvider);

    final filtered = _filter == 'ALL'
        ? sigState.signals
        : sigState.signals.where((s) => s.direction == _filter).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('All Signals'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(signalsProvider.notifier).fetch(),
          ),
        ],
      ),
      body: Column(children: [
        _FilterBar(selected: _filter, onSelect: (f) => setState(() => _filter = f)),
        const Divider(height: 1),
        Expanded(child: sigState.loading
            ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
            : filtered.isEmpty
                ? _emptyState()
                : RefreshIndicator(
                    onRefresh: () => ref.read(signalsProvider.notifier).fetch(),
                    color: AppColors.primary,
                    backgroundColor: AppColors.card,
                    child: ListView.builder(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: filtered.length,
                      itemBuilder: (_, i) => SignalCard(signal: filtered[i]),
                    ),
                  )),
      ]),
    );
  }

  Widget _emptyState() {
    return Center(child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.search_off, size: 48, color: AppColors.textMuted),
        const SizedBox(height: 12),
        Text('No $_filter signals', style: const TextStyle(color: AppColors.textSecondary)),
      ],
    ));
  }
}

class _FilterBar extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _FilterBar({required this.selected, required this.onSelect});

  static const _filters = ['ALL', 'BUY', 'SELL'];

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      color: AppColors.card,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(children: _filters.map((f) {
        final active = f == selected;
        Color color = f == 'BUY' ? AppColors.buy : f == 'SELL' ? AppColors.sell : AppColors.primary;
        return Padding(
          padding: const EdgeInsets.only(right: 8),
          child: GestureDetector(
            onTap: () => onSelect(f),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              decoration: BoxDecoration(
                color: active ? color.withValues(alpha: 0.15) : AppColors.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: active ? color : AppColors.border),
              ),
              child: Text(f,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                    color: active ? color : AppColors.textSecondary,
                  )),
            ),
          ),
        );
      }).toList()),
    );
  }
}
