import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/sparkline_provider.dart';
import '../theme/app_theme.dart';

class SparklineChart extends ConsumerWidget {
  final String asset;
  final double width;
  final double height;

  const SparklineChart({
    super.key,
    required this.asset,
    this.width = 64,
    this.height = 32,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(sparklineProvider(asset));

    return SizedBox(
      width: width,
      height: height,
      child: async.when(
        loading: () => Container(
          decoration: BoxDecoration(
            color: AppColors.border.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        error: (_, __) => const SizedBox.shrink(),
        data: (points) {
          if (points.length < 2) return const SizedBox.shrink();

          final isUp  = points.last >= points.first;
          final color = isUp ? AppColors.buy : AppColors.sell;

          final minY  = points.reduce((a, b) => a < b ? a : b);
          final maxY  = points.reduce((a, b) => a > b ? a : b);
          final range = maxY - minY;
          if (range == 0) return const SizedBox.shrink();

          final spots = points.asMap().entries
              .map((e) => FlSpot(e.key.toDouble(), e.value))
              .toList();

          return LineChart(
            LineChartData(
              minX: 0,
              maxX: (points.length - 1).toDouble(),
              minY: minY - range * 0.1,
              maxY: maxY + range * 0.1,
              gridData:      const FlGridData(show: false),
              borderData:    FlBorderData(show: false),
              titlesData:    const FlTitlesData(show: false),
              lineTouchData: const LineTouchData(enabled: false),
              lineBarsData: [
                LineChartBarData(
                  spots:          spots,
                  isCurved:       true,
                  curveSmoothness: 0.3,
                  color:          color,
                  barWidth:       1.5,
                  dotData:        const FlDotData(show: false),
                  belowBarData:   BarAreaData(
                    show: true,
                    gradient: LinearGradient(
                      colors: [
                        color.withValues(alpha: 0.22),
                        color.withValues(alpha: 0.0),
                      ],
                      begin: Alignment.topCenter,
                      end:   Alignment.bottomCenter,
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
