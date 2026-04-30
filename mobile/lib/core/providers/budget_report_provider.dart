import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Models ────────────────────────────────────────────────────────────────────

class ReportTrades {
  final int    total;
  final int    open;
  final int    wins;
  final int    losses;
  final double winRate;
  final int    avgDurationMinutes;

  const ReportTrades({
    required this.total,
    required this.open,
    required this.wins,
    required this.losses,
    required this.winRate,
    required this.avgDurationMinutes,
  });

  factory ReportTrades.fromJson(Map<String, dynamic> j) => ReportTrades(
    total:              (j['total']              as num?)?.toInt() ?? 0,
    open:               (j['open']               as num?)?.toInt() ?? 0,
    wins:               (j['wins']               as num?)?.toInt() ?? 0,
    losses:             (j['losses']             as num?)?.toInt() ?? 0,
    winRate:            (j['winRate']            as num?)?.toDouble() ?? 0,
    avgDurationMinutes: (j['avgDurationMinutes'] as num?)?.toInt() ?? 0,
  );
}

class ReportPnl {
  final double net;
  final double profit;
  final double loss;
  final double netPct;

  const ReportPnl({
    required this.net,
    required this.profit,
    required this.loss,
    required this.netPct,
  });

  factory ReportPnl.fromJson(Map<String, dynamic> j) => ReportPnl(
    net:    (j['net']    as num?)?.toDouble() ?? 0,
    profit: (j['profit'] as num?)?.toDouble() ?? 0,
    loss:   (j['loss']   as num?)?.toDouble() ?? 0,
    netPct: (j['netPct'] as num?)?.toDouble() ?? 0,
  );
}

class ReportPortfolio {
  final double currentBalance;
  final double startingBalance;
  final double maxDrawdown;
  final double peakBalance;

  const ReportPortfolio({
    required this.currentBalance,
    required this.startingBalance,
    required this.maxDrawdown,
    required this.peakBalance,
  });

  factory ReportPortfolio.fromJson(Map<String, dynamic> j) => ReportPortfolio(
    currentBalance:  (j['currentBalance']  as num?)?.toDouble() ?? 0,
    startingBalance: (j['startingBalance'] as num?)?.toDouble() ?? 0,
    maxDrawdown:     (j['maxDrawdown']     as num?)?.toDouble() ?? 0,
    peakBalance:     (j['peakBalance']     as num?)?.toDouble() ?? 0,
  );
}

class BudgetReport {
  final String          range;
  final String          period;
  final ReportTrades    trades;
  final ReportPnl       pnl;
  final ReportPortfolio portfolio;
  final List<Map<String, dynamic>> balanceHistory;

  const BudgetReport({
    required this.range,
    required this.period,
    required this.trades,
    required this.pnl,
    required this.portfolio,
    required this.balanceHistory,
  });

  factory BudgetReport.fromJson(Map<String, dynamic> j) => BudgetReport(
    range:     j['range']  as String? ?? 'daily',
    period:    j['period'] as String? ?? 'Last 24 hours',
    trades:    ReportTrades.fromJson(j['trades']    as Map<String, dynamic>? ?? {}),
    pnl:       ReportPnl.fromJson(j['pnl']          as Map<String, dynamic>? ?? {}),
    portfolio: ReportPortfolio.fromJson(j['portfolio'] as Map<String, dynamic>? ?? {}),
    balanceHistory: (j['balanceHistory'] as List?)
        ?.map((e) => e as Map<String, dynamic>)
        .toList() ?? [],
  );
}

// ── State ──────────────────────────────────────────────────────────────────────

class BudgetReportState {
  final BudgetReport? daily;
  final BudgetReport? weekly;
  final bool          loadingDaily;
  final bool          loadingWeekly;
  final String?       error;

  const BudgetReportState({
    this.daily,
    this.weekly,
    this.loadingDaily  = false,
    this.loadingWeekly = false,
    this.error,
  });

  BudgetReportState copyWith({
    BudgetReport? daily,
    BudgetReport? weekly,
    bool?         loadingDaily,
    bool?         loadingWeekly,
    String?       error,
    bool          clearError = false,
  }) => BudgetReportState(
    daily:         daily         ?? this.daily,
    weekly:        weekly        ?? this.weekly,
    loadingDaily:  loadingDaily  ?? this.loadingDaily,
    loadingWeekly: loadingWeekly ?? this.loadingWeekly,
    error:         clearError ? null : (error ?? this.error),
  );
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class BudgetReportNotifier extends Notifier<BudgetReportState> {
  @override
  BudgetReportState build() {
    Future.microtask(loadAll);
    return const BudgetReportState(loadingDaily: true, loadingWeekly: true);
  }

  Future<void> loadAll() async {
    await Future.wait([loadDaily(), loadWeekly()]);
  }

  Future<void> loadDaily() async {
    state = state.copyWith(loadingDaily: true, clearError: true);
    try {
      final resp = await ApiService.dio.get('budget/report',
          queryParameters: {'range': 'daily'});
      final data = resp.data as Map<String, dynamic>;
      state = state.copyWith(
        daily:        BudgetReport.fromJson(data),
        loadingDaily: false,
      );
    } catch (e) {
      state = state.copyWith(loadingDaily: false, error: e.toString());
    }
  }

  Future<void> loadWeekly() async {
    state = state.copyWith(loadingWeekly: true);
    try {
      final resp = await ApiService.dio.get('budget/report',
          queryParameters: {'range': 'weekly'});
      final data = resp.data as Map<String, dynamic>;
      state = state.copyWith(
        weekly:        BudgetReport.fromJson(data),
        loadingWeekly: false,
      );
    } catch (e) {
      state = state.copyWith(loadingWeekly: false, error: e.toString());
    }
  }
}

final budgetReportProvider =
    NotifierProvider<BudgetReportNotifier, BudgetReportState>(
        BudgetReportNotifier.new);
