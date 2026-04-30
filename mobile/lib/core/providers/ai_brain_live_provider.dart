import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Models ────────────────────────────────────────────────────────────────────

class AILiveDecision {
  final String  id;
  final String  asset;
  final String  displayName;
  final String  assetClass;
  final String  action;
  final int     confidence;
  final double? entryPrice;
  final double? stopLoss;
  final double? takeProfit;
  final String? riskReward;
  final String? reason;
  final double? rsi;
  final String? trend;
  final double? newsScore;
  final double? fusedScore;
  final bool    tradeCreated;
  final DateTime createdAt;

  const AILiveDecision({
    required this.id,
    required this.asset,
    required this.displayName,
    required this.assetClass,
    required this.action,
    required this.confidence,
    required this.createdAt,
    this.entryPrice,
    this.stopLoss,
    this.takeProfit,
    this.riskReward,
    this.reason,
    this.rsi,
    this.trend,
    this.newsScore,
    this.fusedScore,
    this.tradeCreated = false,
  });

  factory AILiveDecision.fromJson(Map<String, dynamic> j) => AILiveDecision(
    id:           j['_id']         as String? ?? '',
    asset:        j['asset']       as String? ?? '',
    displayName:  j['displayName'] as String? ?? j['asset'] as String? ?? '',
    assetClass:   j['assetClass']  as String? ?? 'crypto',
    action:       j['action']      as String? ?? 'HOLD',
    confidence:   (j['confidence'] as num?)?.toInt() ?? 0,
    entryPrice:   (j['entryPrice'] as num?)?.toDouble(),
    stopLoss:     (j['stopLoss']   as num?)?.toDouble(),
    takeProfit:   (j['takeProfit'] as num?)?.toDouble(),
    riskReward:   j['riskReward']  as String?,
    reason:       j['reason']      as String?,
    rsi:          (j['rsi']        as num?)?.toDouble(),
    trend:        j['trend']       as String?,
    newsScore:    (j['newsScore']  as num?)?.toDouble(),
    fusedScore:   (j['fusedScore'] as num?)?.toDouble(),
    tradeCreated: j['tradeCreated'] as bool? ?? false,
    createdAt:    DateTime.tryParse(j['createdAt'] as String? ?? '') ?? DateTime.now(),
  );
}

class AIBrainLiveState {
  final List<AILiveDecision> decisions;
  final bool                 loading;
  final String?              error;
  final DateTime?            lastUpdated;

  const AIBrainLiveState({
    this.decisions   = const [],
    this.loading     = false,
    this.error,
    this.lastUpdated,
  });

  AIBrainLiveState copyWith({
    List<AILiveDecision>? decisions,
    bool?                 loading,
    String?               error,
    DateTime?             lastUpdated,
    bool                  clearError = false,
  }) => AIBrainLiveState(
    decisions:   decisions   ?? this.decisions,
    loading:     loading     ?? this.loading,
    error:       clearError  ? null : (error ?? this.error),
    lastUpdated: lastUpdated ?? this.lastUpdated,
  );

  // Convenience: latest decision per asset (deduplicated)
  List<AILiveDecision> get latestPerAsset {
    final seen = <String>{};
    return decisions.where((d) => seen.add(d.asset)).toList();
  }
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class AIBrainLiveNotifier extends Notifier<AIBrainLiveState> {
  Timer? _pollTimer;

  @override
  AIBrainLiveState build() {
    ref.onDispose(() => _pollTimer?.cancel());
    Future.microtask(load);
    // Poll every 5 minutes to stay in sync with the worker
    _pollTimer = Timer.periodic(const Duration(minutes: 5), (_) => load());
    return const AIBrainLiveState(loading: true);
  }

  Future<void> load() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final resp = await ApiService.dio.get('ai-brain/latest',
          queryParameters: {'limit': '20'});
      final data = resp.data as Map<String, dynamic>;
      final list = (data['decisions'] as List? ?? [])
          .map((e) => AILiveDecision.fromJson(e as Map<String, dynamic>))
          .toList();
      state = AIBrainLiveState(
        decisions:   list,
        loading:     false,
        lastUpdated: DateTime.now(),
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }
}

final aiBrainLiveProvider =
    NotifierProvider<AIBrainLiveNotifier, AIBrainLiveState>(
        AIBrainLiveNotifier.new);
