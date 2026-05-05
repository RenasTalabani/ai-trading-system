import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/brain_stats_provider.dart';
import '../../core/theme/app_theme.dart';

void showAchievementsSheet(BuildContext context) {
  showModalBottomSheet(
    context: context,
    backgroundColor: AppColors.card,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (_) => const _AchievementsSheet(),
  );
}

class _AchievementsSheet extends ConsumerWidget {
  const _AchievementsSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(brainStatsProvider);

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, ctrl) => Column(children: [
        const SizedBox(height: 12),
        Container(width: 36, height: 4,
            decoration: BoxDecoration(color: AppColors.border,
                borderRadius: BorderRadius.circular(2))),
        const SizedBox(height: 16),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(children: [
            const Text('Achievements',
                style: TextStyle(color: AppColors.textPrimary,
                    fontSize: 20, fontWeight: FontWeight.w800)),
            const Spacer(),
            statsAsync.whenOrNull(data: (s) {
              final earned = s.achievements.where((a) => a.earned).length;
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text('$earned/${s.achievements.length}',
                    style: const TextStyle(color: AppColors.primary,
                        fontSize: 13, fontWeight: FontWeight.w700)),
              );
            }) ?? const SizedBox.shrink(),
          ]),
        ),
        const SizedBox(height: 16),
        Expanded(
          child: statsAsync.when(
            loading: () => const Center(
                child: CircularProgressIndicator(color: AppColors.primary)),
            error: (_, __) => const Center(
                child: Text('Could not load achievements',
                    style: TextStyle(color: AppColors.textMuted))),
            data: (stats) => GridView.builder(
              controller: ctrl,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 1.1,
              ),
              itemCount: stats.achievements.length,
              itemBuilder: (_, i) => _AchievementCard(a: stats.achievements[i]),
            ),
          ),
        ),
      ]),
    );
  }
}

class _AchievementCard extends StatelessWidget {
  final Achievement a;
  const _AchievementCard({required this.a});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: a.earned
            ? AppColors.primary.withValues(alpha: 0.08)
            : AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: a.earned
              ? AppColors.primary.withValues(alpha: 0.35)
              : AppColors.border,
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(a.icon, style: TextStyle(
              fontSize: 26,
              color: a.earned ? null : const Color(0x00000000))),
          if (!a.earned)
            const Positioned.fill(
                child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text('🔒',
                        style: TextStyle(fontSize: 22,
                            color: AppColors.textMuted)))),
          const Spacer(),
          if (a.earned)
            Container(
              width: 20, height: 20,
              decoration: const BoxDecoration(
                  color: AppColors.buy, shape: BoxShape.circle),
              child: const Icon(Icons.check, size: 13, color: Colors.white),
            ),
        ]),
        const Spacer(),
        Text(a.name,
            maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(
                color: a.earned ? AppColors.textPrimary : AppColors.textMuted,
                fontWeight: FontWeight.w700, fontSize: 13)),
        const SizedBox(height: 3),
        Text(a.description,
            maxLines: 2, overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 11,
                height: 1.3)),
        if (!a.earned) ...[
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: a.progressFraction,
              backgroundColor: AppColors.border,
              valueColor: const AlwaysStoppedAnimation(AppColors.primary),
              minHeight: 3,
            ),
          ),
          const SizedBox(height: 3),
          Text('${a.progress.toStringAsFixed(0)}/${a.goal.toStringAsFixed(0)}${a.unit}',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 10)),
        ],
      ]),
    );
  }
}
