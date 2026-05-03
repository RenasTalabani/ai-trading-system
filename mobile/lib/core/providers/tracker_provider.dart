import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class AccuracyStats {
  final int    total;
  final int    correct;
  final int    accuracy;
  final double avgProfitPerTrade;
  final int    pending;

  const AccuracyStats({
    required this.total,
    required this.correct,
    required this.accuracy,
    required this.avgProfitPerTrade,
    required this.pending,
  });

  factory AccuracyStats.fromJson(Map<String, dynamic> j) => AccuracyStats(
    total:             (j['total']   as num?)?.toInt()    ?? 0,
    correct:           (j['correct'] as num?)?.toInt()    ?? 0,
    accuracy:          (j['accuracy'] as num?)?.toInt()   ?? 0,
    avgProfitPerTrade: (j['avgProfitPerTrade'] as num?)?.toDouble() ?? 0.0,
    pending:           (j['pending'] as num?)?.toInt()    ?? 0,
  );
}

final trackerAccuracyProvider = FutureProvider<AccuracyStats>((ref) async {
  final resp = await ApiService.dio.get('tracker/accuracy');
  return AccuracyStats.fromJson(resp.data as Map<String, dynamic>);
});
