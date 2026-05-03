import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Form state ────────────────────────────────────────────────────────────────

class SimulatorFormState {
  final double capital;
  final List<String> assets;
  final int durationDays;
  final double riskPct;

  const SimulatorFormState({
    this.capital     = 500,
    this.assets      = const ['BTCUSDT', 'ETHUSDT'],
    this.durationDays = 7,
    this.riskPct     = 5,
  });

  SimulatorFormState copyWith({
    double? capital,
    List<String>? assets,
    int? durationDays,
    double? riskPct,
  }) => SimulatorFormState(
    capital:      capital      ?? this.capital,
    assets:       assets       ?? this.assets,
    durationDays: durationDays ?? this.durationDays,
    riskPct:      riskPct      ?? this.riskPct,
  );
}

final simulatorFormProvider =
    StateProvider<SimulatorFormState>((ref) => const SimulatorFormState());

// ── Result models ─────────────────────────────────────────────────────────────

class SimAssetResult {
  final String asset;
  final double initialCapital;
  final double finalBalance;
  final double profit;
  final double returnPct;
  final int trades;
  final int winTrades;
  final int lossTrades;
  final double winRate;

  const SimAssetResult({
    required this.asset,
    required this.initialCapital,
    required this.finalBalance,
    required this.profit,
    required this.returnPct,
    required this.trades,
    required this.winTrades,
    required this.lossTrades,
    required this.winRate,
  });

  factory SimAssetResult.fromJson(Map<String, dynamic> j) => SimAssetResult(
        asset:          j['asset']           as String? ?? '',
        initialCapital: (j['initial_capital'] as num?)?.toDouble() ?? 0,
        finalBalance:   (j['final_balance']  as num?)?.toDouble() ?? 0,
        profit:         (j['profit']         as num?)?.toDouble() ?? 0,
        returnPct:      (j['return_pct']     as num?)?.toDouble() ?? 0,
        trades:         (j['trades']         as num?)?.toInt() ?? 0,
        winTrades:      (j['win_trades']     as num?)?.toInt() ?? 0,
        lossTrades:     (j['loss_trades']    as num?)?.toInt() ?? 0,
        winRate:        (j['win_rate']       as num?)?.toDouble() ?? 0,
      );
}

class SimulatorResult {
  final double capital;
  final double finalBalance;
  final double profit;
  final double profitPct;
  final int totalTrades;
  final double winRate;
  final int durationDays;
  final double riskPct;
  final String summary;
  final List<SimAssetResult> perAsset;

  const SimulatorResult({
    required this.capital,
    required this.finalBalance,
    required this.profit,
    required this.profitPct,
    required this.totalTrades,
    required this.winRate,
    required this.durationDays,
    required this.riskPct,
    required this.summary,
    required this.perAsset,
  });

  factory SimulatorResult.fromJson(Map<String, dynamic> j) => SimulatorResult(
        capital:      (j['capital']       as num?)?.toDouble() ?? 0,
        finalBalance: (j['final_balance'] as num?)?.toDouble() ?? 0,
        profit:       (j['profit']        as num?)?.toDouble() ?? 0,
        profitPct:    (j['profit_pct']    as num?)?.toDouble() ?? 0,
        totalTrades:  (j['total_trades']  as num?)?.toInt() ?? 0,
        winRate:      (j['win_rate']      as num?)?.toDouble() ?? 0,
        durationDays: (j['duration_days'] as num?)?.toInt() ?? 7,
        riskPct:      (j['risk_pct']      as num?)?.toDouble() ?? 5,
        summary:      j['summary']        as String? ?? '',
        perAsset: ((j['per_asset'] as List?) ?? [])
            .map((e) => SimAssetResult.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

// ── Provider ──────────────────────────────────────────────────────────────────

class SimulatorState {
  final bool loading;
  final SimulatorResult? result;
  final String? error;
  const SimulatorState({this.loading = false, this.result, this.error});
  SimulatorState copyWith({bool? loading, SimulatorResult? result, String? error}) =>
      SimulatorState(loading: loading ?? this.loading, result: result ?? this.result, error: error);
}

class SimulatorNotifier extends StateNotifier<SimulatorState> {
  SimulatorNotifier() : super(const SimulatorState());

  Future<void> run({
    required double capital,
    required List<String> assets,
    required int durationDays,
    required double riskPct,
  }) async {
    state = const SimulatorState(loading: true);
    try {
      final resp = await ApiService.dio.post(
        'simulator/run',
        data: {
          'capital':      capital,
          'assets':       assets,
          'duration_days': durationDays,
          'risk_pct':     riskPct,
        },
        options: ApiService.slowOptions,
      );
      state = SimulatorState(result: SimulatorResult.fromJson(resp.data as Map<String, dynamic>));
    } catch (e) {
      state = SimulatorState(error: e.toString());
    }
  }

  void reset() => state = const SimulatorState();
}

final simulatorProvider =
    StateNotifierProvider<SimulatorNotifier, SimulatorState>((ref) => SimulatorNotifier());
