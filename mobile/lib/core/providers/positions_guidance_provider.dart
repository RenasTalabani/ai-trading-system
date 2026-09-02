import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

class PositionGuidance {
  final String tradeId;
  final String asset;
  final String direction; // BUY or SELL
  final double sizeUsd;
  final double entryPrice;
  final double? currentPrice; // null = asset currently halted on the exchange
  final double? pnlPct;       // null = asset currently halted on the exchange
  final String recommendation; // HOLD or SELL
  final List<String> why;
  final String? holdEstimate;
  final double? maxLossUsd; // null = no stop-loss set, downside undefined
  final double? maxGainUsd; // null = no take-profit set, upside undefined

  const PositionGuidance({
    required this.tradeId,
    required this.asset,
    required this.direction,
    required this.sizeUsd,
    required this.entryPrice,
    required this.currentPrice,
    required this.pnlPct,
    required this.recommendation,
    required this.why,
    required this.holdEstimate,
    required this.maxLossUsd,
    required this.maxGainUsd,
  });

  factory PositionGuidance.fromJson(Map<String, dynamic> json) => PositionGuidance(
    tradeId:        json['tradeId'] as String,
    asset:          json['asset'] as String,
    direction:      json['direction'] as String,
    sizeUsd:        (json['sizeUsd'] as num).toDouble(),
    entryPrice:     (json['entryPrice'] as num).toDouble(),
    // Bug fix (UI/backend audit): guideController.buildPositionGuidance()
    // sends currentPrice/pnlPct as null for an asset currently halted on
    // the exchange (see backend/src/controllers/guideController.js's
    // halted-asset branch). Force-casting to non-nullable `num` threw an
    // uncaught TypeError -- not caught by fetch()'s `on DioException`
    // handler -- breaking the entire Guide positions list whenever any one
    // tracked asset was halted.
    currentPrice:   (json['currentPrice'] as num?)?.toDouble(),
    pnlPct:         (json['pnlPct'] as num?)?.toDouble(),
    recommendation: json['recommendation'] as String,
    why:            (json['why'] as List).map((e) => e.toString()).toList(),
    holdEstimate:   json['holdEstimate'] as String?,
    maxLossUsd:     (json['maxLossUsd'] as num?)?.toDouble(),
    maxGainUsd:     (json['maxGainUsd'] as num?)?.toDouble(),
  );
}

class PositionsGuidanceState {
  final bool loading;
  final List<PositionGuidance> positions;
  final double totalAtRiskUsd;
  final double totalAtRiskPct;
  final int positionsWithoutStopLoss;
  final double totalPotentialGainUsd;
  final double totalPotentialGainPct;
  final int positionsWithoutTakeProfit;
  final String? error;
  final String? sellingTradeId; // set while a "Sell Now" tap is in flight
  final String? lastSellMessage;

  const PositionsGuidanceState({
    this.loading = false,
    this.positions = const [],
    this.totalAtRiskUsd = 0,
    this.totalAtRiskPct = 0,
    this.positionsWithoutStopLoss = 0,
    this.totalPotentialGainUsd = 0,
    this.totalPotentialGainPct = 0,
    this.positionsWithoutTakeProfit = 0,
    this.error,
    this.sellingTradeId,
    this.lastSellMessage,
  });

  PositionsGuidanceState copyWith({
    bool? loading,
    List<PositionGuidance>? positions,
    double? totalAtRiskUsd,
    double? totalAtRiskPct,
    int? positionsWithoutStopLoss,
    double? totalPotentialGainUsd,
    double? totalPotentialGainPct,
    int? positionsWithoutTakeProfit,
    String? error,
    String? sellingTradeId,
    String? lastSellMessage,
  }) => PositionsGuidanceState(
    loading: loading ?? this.loading,
    positions: positions ?? this.positions,
    totalAtRiskUsd: totalAtRiskUsd ?? this.totalAtRiskUsd,
    totalAtRiskPct: totalAtRiskPct ?? this.totalAtRiskPct,
    positionsWithoutStopLoss: positionsWithoutStopLoss ?? this.positionsWithoutStopLoss,
    totalPotentialGainUsd: totalPotentialGainUsd ?? this.totalPotentialGainUsd,
    totalPotentialGainPct: totalPotentialGainPct ?? this.totalPotentialGainPct,
    positionsWithoutTakeProfit: positionsWithoutTakeProfit ?? this.positionsWithoutTakeProfit,
    error: error,
    sellingTradeId: sellingTradeId,
    lastSellMessage: lastSellMessage,
  );
}

class PositionsGuidanceNotifier extends StateNotifier<PositionsGuidanceState> {
  Timer? _autoRefreshTimer;

  PositionsGuidanceNotifier() : super(const PositionsGuidanceState()) {
    fetch();
    // "Always on" -- keeps the live risk/gain totals current without any
    // action from the user, on the same cadence as the rest of the Guide screen.
    _autoRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (state.sellingTradeId == null) fetch(silent: true);
    });
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> fetch({bool silent = false}) async {
    if (!silent) state = const PositionsGuidanceState(loading: true);
    try {
      final res = await ApiService.dio.get(ApiConstants.guidePositions);
      final data = res.data as Map<String, dynamic>;
      final list = (data['positions'] as List)
          .map((j) => PositionGuidance.fromJson(j as Map<String, dynamic>))
          .toList();
      state = PositionsGuidanceState(
        positions: list,
        totalAtRiskUsd: (data['totalAtRiskUsd'] as num?)?.toDouble() ?? 0,
        totalAtRiskPct: (data['totalAtRiskPct'] as num?)?.toDouble() ?? 0,
        positionsWithoutStopLoss: data['positionsWithoutStopLoss'] as int? ?? 0,
        totalPotentialGainUsd: (data['totalPotentialGainUsd'] as num?)?.toDouble() ?? 0,
        totalPotentialGainPct: (data['totalPotentialGainPct'] as num?)?.toDouble() ?? 0,
        positionsWithoutTakeProfit: data['positionsWithoutTakeProfit'] as int? ?? 0,
      );
    } on DioException catch (_) {
      if (!silent) {
        state = const PositionsGuidanceState(error: "Couldn't load your positions right now.");
      }
    }
  }

  Future<void> sellNow(String tradeId) async {
    if (state.sellingTradeId != null) return;
    state = state.copyWith(sellingTradeId: tradeId);
    try {
      final res = await ApiService.dio.post('${ApiConstants.guidePositions}/$tradeId/sell');
      final message = (res.data as Map<String, dynamic>)['message'] as String? ?? 'Sold.';
      // Same pattern as approve(): show the confirmation for a beat, then refresh.
      state = state.copyWith(
        positions: state.positions.where((p) => p.tradeId != tradeId).toList(),
        sellingTradeId: null,
        lastSellMessage: message,
      );
      await Future.delayed(const Duration(seconds: 2));
      await fetch();
    } on DioException catch (e) {
      final msg = (e.response?.data as Map?)?['message'] as String? ?? "Couldn't sell that right now — try again.";
      state = state.copyWith(sellingTradeId: null, error: msg);
    }
  }
}

final positionsGuidanceProvider =
    StateNotifierProvider<PositionsGuidanceNotifier, PositionsGuidanceState>(
  (ref) => PositionsGuidanceNotifier(),
);
