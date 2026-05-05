import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class AssetAnalytics {
  final String asset;
  final String displayName;
  final String assetClass;
  final int    total;
  final int    wins;
  final int    losses;
  final int    winRate;
  final double avgProfitPct;
  final double bestProfitPct;
  final double worstProfitPct;
  final String? lastSignal;
  final DateTime? lastAt;

  const AssetAnalytics({
    required this.asset, required this.displayName, required this.assetClass,
    required this.total, required this.wins, required this.losses,
    required this.winRate, required this.avgProfitPct,
    required this.bestProfitPct, required this.worstProfitPct,
    this.lastSignal, this.lastAt,
  });

  factory AssetAnalytics.fromJson(Map<String, dynamic> j) => AssetAnalytics(
    asset:          j['asset']?.toString()       ?? '',
    displayName:    j['displayName']?.toString() ?? '',
    assetClass:     j['assetClass']?.toString()  ?? 'crypto',
    total:          (j['total']    as num?)?.toInt()    ?? 0,
    wins:           (j['wins']     as num?)?.toInt()    ?? 0,
    losses:         (j['losses']   as num?)?.toInt()    ?? 0,
    winRate:        (j['winRate']  as num?)?.toInt()    ?? 0,
    avgProfitPct:   (j['avgProfitPct']   as num?)?.toDouble() ?? 0,
    bestProfitPct:  (j['bestProfitPct']  as num?)?.toDouble() ?? 0,
    worstProfitPct: (j['worstProfitPct'] as num?)?.toDouble() ?? 0,
    lastSignal:     j['lastSignal']?.toString(),
    lastAt:         j['lastAt'] != null
        ? DateTime.tryParse(j['lastAt'].toString()) : null,
  );

  String get grade {
    if (winRate >= 80) return 'S';
    if (winRate >= 70) return 'A';
    if (winRate >= 60) return 'B';
    if (winRate >= 50) return 'C';
    return 'D';
  }
}

class OverallAnalytics {
  final int    total;
  final int    wins;
  final int    losses;
  final int    winRate;
  final double? avgProfitPct;

  const OverallAnalytics({
    required this.total, required this.wins, required this.losses,
    required this.winRate, this.avgProfitPct,
  });

  factory OverallAnalytics.fromJson(Map<String, dynamic> j) => OverallAnalytics(
    total:        (j['total']   as num?)?.toInt() ?? 0,
    wins:         (j['wins']    as num?)?.toInt() ?? 0,
    losses:       (j['losses']  as num?)?.toInt() ?? 0,
    winRate:      (j['winRate'] as num?)?.toInt() ?? 0,
    avgProfitPct: (j['avgProfitPct'] as num?)?.toDouble(),
  );
}

class BrainAnalytics {
  final OverallAnalytics      overall;
  final List<AssetAnalytics>  assets;

  const BrainAnalytics({required this.overall, required this.assets});

  factory BrainAnalytics.fromJson(Map<String, dynamic> j) => BrainAnalytics(
    overall: OverallAnalytics.fromJson(
        j['overall'] as Map<String, dynamic>? ?? {}),
    assets: (j['assets'] as List? ?? [])
        .map((a) => AssetAnalytics.fromJson(a as Map<String, dynamic>))
        .toList(),
  );
}

final brainAnalyticsProvider = FutureProvider.autoDispose<BrainAnalytics>((ref) async {
  final resp = await ApiService.dio.get('brain/analytics');
  return BrainAnalytics.fromJson(resp.data as Map<String, dynamic>);
});
