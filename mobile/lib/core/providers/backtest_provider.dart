import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/backtest_model.dart';
import '../services/api_service.dart';

class BacktestState {
  final BacktestResultModel? result;
  final bool loading;
  final String? error;

  const BacktestState({this.result, this.loading = false, this.error});

  BacktestState copyWith({BacktestResultModel? result, bool? loading, String? error}) =>
      BacktestState(
        result:  result  ?? this.result,
        loading: loading ?? this.loading,
        error:   error,
      );
}

/// Runs the AI service's model-based backtest (distinct from the Strategy
/// Simulator's EMA-crossover simulation) — replays the actual signal-generation
/// pipeline over historical candles to see how it would have performed.
class BacktestNotifier extends Notifier<BacktestState> {
  @override
  BacktestState build() => const BacktestState();

  Future<void> run({
    required String asset,
    String interval = '1h',
    double minConfidence = 65,
  }) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final resp = await ApiService.dio.post('ai/backtest', data: {
        'asset': asset,
        'interval': interval,
        'min_confidence': minConfidence,
      });
      state = BacktestState(
        result: BacktestResultModel.fromJson(resp.data['result'] as Map<String, dynamic>),
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }
}

final backtestProvider = NotifierProvider<BacktestNotifier, BacktestState>(
  BacktestNotifier.new,
);
