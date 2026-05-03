import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Report model ──────────────────────────────────────────────────────────────

class AIReport {
  final String id;
  final String type;
  final String marketMood;
  final int moodPct;
  final String topAsset;
  final String topAction;
  final double topConfidence;
  final int activeSignals;
  final String? bestAsset;
  final String? bestAction;
  final double? bestConfidence;
  final String? bestReason;
  final double portfolioBalance;
  final double portfolioChange;
  final int openTrades;
  final String aiInsight;
  final DateTime createdAt;

  const AIReport({
    required this.id,
    required this.type,
    required this.marketMood,
    required this.moodPct,
    required this.topAsset,
    required this.topAction,
    required this.topConfidence,
    required this.activeSignals,
    this.bestAsset,
    this.bestAction,
    this.bestConfidence,
    this.bestReason,
    required this.portfolioBalance,
    required this.portfolioChange,
    required this.openTrades,
    required this.aiInsight,
    required this.createdAt,
  });

  factory AIReport.fromJson(Map<String, dynamic> j) {
    final ms  = (j['marketSummary']    as Map?) ?? {};
    final bo  = (j['bestOpportunity']  as Map?) ?? {};
    final ps  = (j['portfolioSummary'] as Map?) ?? {};
    return AIReport(
      id:               j['_id']             as String? ?? '',
      type:             j['type']            as String? ?? 'hourly',
      marketMood:       ms['marketMood']     as String? ?? 'neutral',
      moodPct:         (ms['moodPct']   as num?)?.toInt() ?? 50,
      topAsset:         ms['topAsset']       as String? ?? '',
      topAction:        ms['topAction']      as String? ?? 'HOLD',
      topConfidence:   (ms['topConfidence'] as num?)?.toDouble() ?? 0,
      activeSignals:   (ms['activeSignals'] as num?)?.toInt() ?? 0,
      bestAsset:        bo['asset']          as String?,
      bestAction:       bo['action']         as String?,
      bestConfidence:  (bo['confidence'] as num?)?.toDouble(),
      bestReason:       bo['reason']         as String?,
      portfolioBalance:(ps['balance']  as num?)?.toDouble() ?? 500,
      portfolioChange: (ps['change']   as num?)?.toDouble() ?? 0,
      openTrades:      (ps['openTrades'] as num?)?.toInt() ?? 0,
      aiInsight:        j['aiInsight']       as String? ?? '',
      createdAt:        j['createdAt'] != null
          ? DateTime.tryParse(j['createdAt'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

class ReportsState {
  final bool loading;
  final AIReport? latest;
  final List<AIReport> history;
  final String? error;

  const ReportsState({
    this.loading = false,
    this.latest,
    this.history = const [],
    this.error,
  });

  ReportsState copyWith({
    bool? loading,
    AIReport? latest,
    List<AIReport>? history,
    String? error,
  }) => ReportsState(
    loading: loading ?? this.loading,
    latest:  latest  ?? this.latest,
    history: history ?? this.history,
    error:   error,
  );
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class ReportsNotifier extends StateNotifier<ReportsState> {
  ReportsNotifier() : super(const ReportsState());

  Future<void> fetchLatest({String type = 'hourly'}) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final resp = await ApiService.dio.get('reports/latest', queryParameters: {'type': type});
      final data = resp.data as Map<String, dynamic>;
      final r    = data['report'];
      state = state.copyWith(
        loading: false,
        latest:  r != null ? AIReport.fromJson(r as Map<String, dynamic>) : null,
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }

  Future<void> fetchHistory({String type = 'hourly', int limit = 24}) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final resp = await ApiService.dio.get(
        'reports/history',
        queryParameters: {'type': type, 'limit': limit},
      );
      final data    = resp.data as Map<String, dynamic>;
      final reports = ((data['reports'] as List?) ?? [])
          .map((e) => AIReport.fromJson(e as Map<String, dynamic>))
          .toList();
      state = state.copyWith(loading: false, history: reports);
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }
}

final reportsProvider =
    StateNotifierProvider<ReportsNotifier, ReportsState>((ref) => ReportsNotifier());
