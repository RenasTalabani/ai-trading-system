import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class CandleData {
  final DateTime timestamp;
  final double   open;
  final double   high;
  final double   low;
  final double   close;
  final double   volume;
  final double?  ema20;
  final double?  ema50;
  final double?  rsi;

  const CandleData({
    required this.timestamp, required this.open, required this.high,
    required this.low,       required this.close, required this.volume,
    this.ema20, this.ema50, this.rsi,
  });

  factory CandleData.fromJson(Map<String, dynamic> j) {
    final ind = j['indicators'] as Map<String, dynamic>?;
    return CandleData(
      timestamp: DateTime.tryParse(j['timestamp']?.toString() ?? '') ?? DateTime.now(),
      open:   (j['open']   as num?)?.toDouble() ?? 0,
      high:   (j['high']   as num?)?.toDouble() ?? 0,
      low:    (j['low']    as num?)?.toDouble() ?? 0,
      close:  (j['close']  as num?)?.toDouble() ?? 0,
      volume: (j['volume'] as num?)?.toDouble() ?? 0,
      ema20:  (ind?['ema20'] as num?)?.toDouble(),
      ema50:  (ind?['ema50'] as num?)?.toDouble(),
      rsi:    (ind?['rsi']   as num?)?.toDouble(),
    );
  }
}

class ChartQuery {
  final String asset;
  final String interval;
  final int    limit;
  const ChartQuery({required this.asset, required this.interval, required this.limit});

  @override
  bool operator ==(Object other) =>
      other is ChartQuery && other.asset == asset &&
      other.interval == interval && other.limit == limit;

  @override
  int get hashCode => Object.hash(asset, interval, limit);
}

// Returns candles sorted oldest → newest
final chartProvider =
    FutureProvider.autoDispose.family<List<CandleData>, ChartQuery>((ref, q) async {
  final resp = await ApiService.dio.get(
    'market/history/${q.asset}',
    queryParameters: {'interval': q.interval, 'limit': q.limit},
  );
  final data = resp.data['data'] as List? ?? [];
  final candles = data
      .map((j) => CandleData.fromJson(j as Map<String, dynamic>))
      .toList();
  return candles.reversed.toList();
});
