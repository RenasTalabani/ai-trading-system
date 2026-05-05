import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// Returns close prices oldest→newest for the last 24 1h candles
final sparklineProvider =
    FutureProvider.autoDispose.family<List<double>, String>((ref, asset) async {
  if (asset.isEmpty) return [];
  try {
    final resp = await ApiService.dio.get(
      'market/history/$asset',
      queryParameters: {'interval': '1h', 'limit': 24},
    );
    final data = resp.data['data'] as List? ?? [];
    final closes = data
        .map((c) => (c['close'] as num?)?.toDouble())
        .whereType<double>()
        .toList();
    return closes.reversed.toList();
  } catch (_) {
    return [];
  }
});
