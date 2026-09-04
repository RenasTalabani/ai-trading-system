import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';
import '../models/risk_state_model.dart';

// Master-plan decision #16: the daily-loss circuit breaker. This provider's
// only job on the main screen is "is the AI currently halted, and why" --
// and, if so, offering the one deliberate human action that clears it.
class RiskStateState {
  final bool loading;
  final bool resetting;
  final RiskStateModel state;
  final String? error;

  const RiskStateState({
    this.loading = false,
    this.resetting = false,
    this.state = RiskStateModel.notHalted,
    this.error,
  });

  RiskStateState copyWith({
    bool? loading,
    bool? resetting,
    RiskStateModel? state,
    String? error,
  }) => RiskStateState(
    loading:   loading   ?? this.loading,
    resetting: resetting ?? this.resetting,
    state:     state     ?? this.state,
    error:     error,
  );
}

class RiskStateNotifier extends StateNotifier<RiskStateState> {
  Timer? _autoRefreshTimer;

  RiskStateNotifier() : super(const RiskStateState()) {
    fetch();
    // A halt can happen at any moment while this screen sits open (the AI
    // worker cycle runs independently of the app being open) -- check on
    // the same one-minute cadence as the guide suggestion and allocation
    // proposal, so it's noticed without the user having to pull to refresh.
    _autoRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) => fetch(silent: true));
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> fetch({bool silent = false}) async {
    if (!silent) state = state.copyWith(loading: true, error: null);
    try {
      final res = await ApiService.dio.get(ApiConstants.riskState);
      final data = (res.data as Map<String, dynamic>)['data'] as Map<String, dynamic>;
      state = state.copyWith(loading: false, state: RiskStateModel.fromJson(data));
    } on DioException catch (_) {
      // A failed background check shouldn't disrupt the screen -- but it
      // also must never silently pretend "not halted" if we genuinely don't
      // know, so a failed fetch only ever updates loading/error, never the
      // halted state itself.
      if (!silent) state = state.copyWith(loading: false, error: "Couldn't check safety status.");
    }
  }

  // Only a deliberate human action reaches this -- there is no auto-clear
  // anywhere in this app, per decision #16.
  Future<bool> resetHalt() async {
    if (state.resetting) return false;
    state = state.copyWith(resetting: true, error: null);
    try {
      final res = await ApiService.dio.post(ApiConstants.riskStateReset);
      final data = (res.data as Map<String, dynamic>)['data'] as Map<String, dynamic>;
      state = state.copyWith(resetting: false, state: RiskStateModel.fromJson(data));
      return true;
    } on DioException catch (e) {
      final msg = (e.response?.data as Map?)?['message'] as String? ?? "Couldn't resume trading — try again.";
      state = state.copyWith(resetting: false, error: msg);
      return false;
    }
  }
}

final riskStateProvider = StateNotifierProvider<RiskStateNotifier, RiskStateState>(
  (ref) => RiskStateNotifier(),
);
