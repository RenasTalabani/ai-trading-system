import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/strategy_model.dart';
import '../services/api_service.dart';

// ─── Available assets (matches backend TRACKED_ASSETS) ───────────────────────

const kTrackedAssets = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT',
];

// ─── Form state ───────────────────────────────────────────────────────────────

class StrategyFormState {
  final Set<String> selectedAssets;
  final String timeframe;
  final double capital;

  const StrategyFormState({
    this.selectedAssets = const {'BTCUSDT', 'ETHUSDT', 'SOLUSDT'},
    this.timeframe      = '7d',
    this.capital        = 500,
  });

  StrategyFormState copyWith({
    Set<String>? selectedAssets,
    String?      timeframe,
    double?      capital,
  }) => StrategyFormState(
    selectedAssets: selectedAssets ?? this.selectedAssets,
    timeframe:      timeframe      ?? this.timeframe,
    capital:        capital        ?? this.capital,
  );
}

final strategyFormProvider =
    StateProvider<StrategyFormState>((ref) => const StrategyFormState());

// ─── Holding provider ─────────────────────────────────────────────────────────

class HoldingNotifier extends AsyncNotifier<HoldingResult?> {
  @override
  Future<HoldingResult?> build() async => null;

  Future<void> analyze() async {
    final form = ref.read(strategyFormProvider);
    if (form.selectedAssets.isEmpty) return;

    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final resp = await ApiService.dio.post('/strategy/holding', data: {
        'assets':    form.selectedAssets.toList(),
        'timeframe': form.timeframe,
        'capital':   form.capital,
      });
      return HoldingResult.fromJson(resp.data['data'] as Map<String, dynamic>);
    });
  }
}

final holdingProvider =
    AsyncNotifierProvider<HoldingNotifier, HoldingResult?>(HoldingNotifier.new);

// ─── Simulation provider ──────────────────────────────────────────────────────

class SimulationNotifier extends AsyncNotifier<SimulationResult?> {
  @override
  Future<SimulationResult?> build() async => null;

  Future<void> simulate() async {
    final form = ref.read(strategyFormProvider);
    if (form.selectedAssets.isEmpty) return;

    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final resp = await ApiService.dio.post('/strategy/simulate', data: {
        'assets':    form.selectedAssets.toList(),
        'timeframe': form.timeframe,
        'capital':   form.capital,
      });
      return SimulationResult.fromJson(resp.data['data'] as Map<String, dynamic>);
    });
  }
}

final simulationProvider =
    AsyncNotifierProvider<SimulationNotifier, SimulationResult?>(SimulationNotifier.new);
