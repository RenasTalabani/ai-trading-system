import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Models ───────────────────────────────────────────────────────────────────

class Achievement {
  final String id;
  final String name;
  final String description;
  final String icon;
  final bool   earned;
  final double progress;
  final double goal;
  final String unit;

  const Achievement({
    required this.id, required this.name, required this.description,
    required this.icon, required this.earned,
    required this.progress, required this.goal, this.unit = '',
  });

  factory Achievement.fromJson(Map<String, dynamic> j) => Achievement(
    id:          j['id']?.toString()          ?? '',
    name:        j['name']?.toString()        ?? '',
    description: j['description']?.toString() ?? '',
    icon:        j['icon']?.toString()        ?? '🏅',
    earned:      j['earned'] == true,
    progress:    (j['progress'] as num?)?.toDouble() ?? 0,
    goal:        (j['goal']     as num?)?.toDouble() ?? 1,
    unit:        j['unit']?.toString() ?? '',
  );

  double get progressFraction => goal > 0 ? (progress / goal).clamp(0.0, 1.0) : 0;
}

class HeatmapDay {
  final String date;   // 'YYYY-MM-DD'
  final int    wins;
  final int    losses;
  final String result; // WIN / LOSS / MIXED

  const HeatmapDay({
    required this.date, required this.wins,
    required this.losses, required this.result,
  });

  factory HeatmapDay.fromJson(Map<String, dynamic> j) => HeatmapDay(
    date:   j['date']?.toString()   ?? '',
    wins:   (j['wins']   as num?)?.toInt() ?? 0,
    losses: (j['losses'] as num?)?.toInt() ?? 0,
    result: j['result']?.toString() ?? 'MIXED',
  );
}

class BrainStats {
  final int    currentStreak;
  final int    bestStreak;
  final int    totalWins;
  final int    totalLosses;
  final int    totalEvaluated;
  final int    winRate;
  final int?   weeklyAccuracy;
  final int    weeklyTotal;
  final List<Achievement> achievements;
  final List<HeatmapDay>  heatmap;

  const BrainStats({
    required this.currentStreak, required this.bestStreak,
    required this.totalWins, required this.totalLosses,
    required this.totalEvaluated, required this.winRate,
    required this.achievements, required this.heatmap,
    required this.weeklyTotal,
    this.weeklyAccuracy,
  });

  factory BrainStats.fromJson(Map<String, dynamic> j) => BrainStats(
    currentStreak:  (j['currentStreak']  as num?)?.toInt() ?? 0,
    bestStreak:     (j['bestStreak']     as num?)?.toInt() ?? 0,
    totalWins:      (j['totalWins']      as num?)?.toInt() ?? 0,
    totalLosses:    (j['totalLosses']    as num?)?.toInt() ?? 0,
    totalEvaluated: (j['totalEvaluated'] as num?)?.toInt() ?? 0,
    winRate:        (j['winRate']        as num?)?.toInt() ?? 0,
    weeklyAccuracy: (j['weeklyAccuracy'] as num?)?.toInt(),
    weeklyTotal:    (j['weeklyTotal']    as num?)?.toInt() ?? 0,
    achievements: (j['achievements'] as List? ?? [])
        .map((a) => Achievement.fromJson(a as Map<String, dynamic>))
        .toList(),
    heatmap: (j['heatmap'] as List? ?? [])
        .map((h) => HeatmapDay.fromJson(h as Map<String, dynamic>))
        .toList(),
  );
}

// ── Provider ─────────────────────────────────────────────────────────────────

final brainStatsProvider = FutureProvider.autoDispose<BrainStats>((ref) async {
  final resp = await ApiService.dio.get('brain/stats');
  return BrainStats.fromJson(resp.data as Map<String, dynamic>);
});
