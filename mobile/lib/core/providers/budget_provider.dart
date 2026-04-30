import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Models ────────────────────────────────────────────────────────────────────

class BudgetSession {
  final String    status;
  final double    budget;
  final String    riskLevel;
  final String    preferredAsset;
  final DateTime? startedAt;

  const BudgetSession({
    required this.status,
    required this.budget,
    required this.riskLevel,
    required this.preferredAsset,
    this.startedAt,
  });

  bool get isActive => status == 'active';

  factory BudgetSession.fromJson(Map<String, dynamic> j) => BudgetSession(
    status:         j['status']         as String? ?? 'paused',
    budget:         (j['budget']        as num?)?.toDouble() ?? 500.0,
    riskLevel:      j['riskLevel']      as String? ?? 'medium',
    preferredAsset: j['preferredAsset'] as String? ?? 'ALL',
    startedAt:      j['startedAt'] != null
        ? DateTime.tryParse(j['startedAt'] as String)
        : null,
  );
}

class BudgetPerformance {
  final double currentBalance;
  final double startingBalance;
  final double sessionPnL;
  final double totalPnL;
  final double winRate;
  final int    activeTrades;
  final int    totalTrades;
  final double maxDrawdown;

  const BudgetPerformance({
    required this.currentBalance,
    required this.startingBalance,
    required this.sessionPnL,
    required this.totalPnL,
    required this.winRate,
    required this.activeTrades,
    required this.totalTrades,
    required this.maxDrawdown,
  });

  double get balancePnLPct => startingBalance > 0
      ? ((currentBalance - startingBalance) / startingBalance) * 100
      : 0.0;

  factory BudgetPerformance.fromJson(Map<String, dynamic> j) => BudgetPerformance(
    currentBalance:  (j['currentBalance']  as num?)?.toDouble() ?? 0,
    startingBalance: (j['startingBalance'] as num?)?.toDouble() ?? 0,
    sessionPnL:      (j['sessionPnL']      as num?)?.toDouble() ?? 0,
    totalPnL:        (j['totalPnL']        as num?)?.toDouble() ?? 0,
    winRate:         (j['winRate']         as num?)?.toDouble() ?? 0,
    activeTrades:    (j['activeTrades']    as num?)?.toInt() ?? 0,
    totalTrades:     (j['totalTrades']     as num?)?.toInt() ?? 0,
    maxDrawdown:     (j['maxDrawdown']     as num?)?.toDouble() ?? 0,
  );
}

class BudgetState {
  final BudgetSession?     session;
  final BudgetPerformance? performance;
  final bool               loading;
  final String?            error;

  const BudgetState({
    this.session,
    this.performance,
    this.loading = false,
    this.error,
  });

  BudgetState copyWith({
    BudgetSession?     session,
    BudgetPerformance? performance,
    bool?              loading,
    String?            error,
    bool               clearError = false,
  }) => BudgetState(
    session:     session     ?? this.session,
    performance: performance ?? this.performance,
    loading:     loading     ?? this.loading,
    error:       clearError  ? null : (error ?? this.error),
  );
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class BudgetNotifier extends Notifier<BudgetState> {
  @override
  BudgetState build() {
    Future.microtask(loadStatus);
    return const BudgetState(loading: true);
  }

  Future<void> loadStatus() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final resp = await ApiService.dio.get('budget/status');
      final data = resp.data as Map<String, dynamic>;
      state = BudgetState(
        session:     BudgetSession.fromJson(data['session']     as Map<String, dynamic>),
        performance: BudgetPerformance.fromJson(data['performance'] as Map<String, dynamic>),
        loading:     false,
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }

  Future<void> start({
    required double budget,
    String riskLevel     = 'medium',
    String preferredAsset = 'ALL',
  }) async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final resp = await ApiService.dio.post('budget/start', data: {
        'budget':         budget,
        'riskLevel':      riskLevel,
        'preferredAsset': preferredAsset,
      });
      final data = resp.data as Map<String, dynamic>;
      if (data['success'] == false) throw Exception(data['message']);
      await loadStatus();
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }

  Future<void> stop() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      await ApiService.dio.post('budget/stop');
      await loadStatus();
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }
}

final budgetProvider =
    NotifierProvider<BudgetNotifier, BudgetState>(BudgetNotifier.new);
