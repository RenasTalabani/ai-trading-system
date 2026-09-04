import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/benchmark_model.dart';
import '../services/api_service.dart';

// Master-plan decision #22: "outperforming a buy-and-hold BTC benchmark"
// is half of the graduation criterion. Same simple fetch-once-plus-refresh
// pattern as virtualPerformanceProvider.
class BenchmarkNotifier extends AsyncNotifier<BenchmarkComparisonModel> {
  @override
  Future<BenchmarkComparisonModel> build() => _fetch();

  Future<BenchmarkComparisonModel> _fetch() async {
    final resp = await ApiService.dio.get('virtual/benchmark');
    return BenchmarkComparisonModel.fromJson(resp.data['data'] as Map<String, dynamic>);
  }

  Future<void> fetch() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetch);
  }
}

final benchmarkProvider = AsyncNotifierProvider<BenchmarkNotifier, BenchmarkComparisonModel>(
  BenchmarkNotifier.new,
);
