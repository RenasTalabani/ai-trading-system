import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../models/signal_model.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

class SignalsState {
  final List<SignalModel> signals;
  final bool loading;
  final bool refreshing;
  final String? error;

  const SignalsState({
    this.signals   = const [],
    this.loading   = false,
    this.refreshing = false,
    this.error,
  });

  SignalsState copyWith({
    List<SignalModel>? signals,
    bool? loading,
    bool? refreshing,
    String? error,
  }) => SignalsState(
    signals:    signals    ?? this.signals,
    loading:    loading    ?? this.loading,
    refreshing: refreshing ?? this.refreshing,
    error:      error,
  );
}

class SignalsNotifier extends StateNotifier<SignalsState> {
  SignalsNotifier() : super(const SignalsState()) {
    fetch();
  }

  Future<void> fetch() async {
    state = state.copyWith(loading: state.signals.isEmpty, refreshing: state.signals.isNotEmpty);
    try {
      final resp = await ApiService.dio.get(
        ApiConstants.signals,
        queryParameters: {'limit': 30},
      );
      final list = (resp.data['signals'] as List)
          .map((j) => SignalModel.fromJson(j))
          .toList();
      state = state.copyWith(signals: list, loading: false, refreshing: false);
    } on DioException catch (e) {
      state = state.copyWith(loading: false, refreshing: false, error: e.userMessage);
    }
  }

  void addSignal(SignalModel signal) {
    final updated = [signal, ...state.signals];
    state = state.copyWith(signals: updated);
  }
}

final signalsProvider = StateNotifierProvider<SignalsNotifier, SignalsState>(
  (_) => SignalsNotifier(),
);

// Latest signal for a specific asset
final assetSignalProvider = Provider.family<SignalModel?, String>((ref, asset) {
  final signals = ref.watch(signalsProvider).signals;
  try {
    return signals.firstWhere((s) => s.asset == asset && s.status == 'active');
  } catch (_) {
    return null;
  }
});
