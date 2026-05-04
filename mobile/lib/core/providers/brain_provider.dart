import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'core_provider.dart' show EquityPoint;

// ── Report 1: What To Do ─────────────────────────────────────────────────────

class TopPick {
  final String asset;
  final String displayName;
  final String action;
  final int    confidence;
  final String assetClass;
  const TopPick({
    required this.asset, required this.displayName,
    required this.action, required this.confidence, required this.assetClass,
  });
  factory TopPick.fromJson(Map<String, dynamic> j) => TopPick(
    asset:       j['asset']?.toString()       ?? '',
    displayName: j['displayName']?.toString() ?? j['asset']?.toString() ?? '',
    action:      j['action']?.toString()      ?? 'HOLD',
    confidence:  (j['confidence'] as num?)?.toInt() ?? 0,
    assetClass:  j['assetClass']?.toString()  ?? 'crypto',
  );
}

class ActionReport {
  final String   bestAsset;
  final String   displayName;
  final String   assetClass;
  final String   action;
  final double?  entryPrice;
  final double?  stopLoss;
  final double?  takeProfit;
  final String?  riskReward;
  final String   timeframe;
  final int      confidence;
  final String?  expectedProfitPercent;
  final String   reason;
  final List<TopPick> topPicks;
  final String?  macroSentiment;
  final int?     fearGreed;
  final String?  fearGreedClass;
  final int?     aiAccuracy;
  final int      totalEvaluated;
  final DateTime? generatedAt;

  const ActionReport({
    required this.bestAsset, required this.displayName, required this.assetClass,
    required this.action, required this.timeframe, required this.confidence,
    required this.reason, required this.topPicks, required this.totalEvaluated,
    this.entryPrice, this.stopLoss, this.takeProfit, this.riskReward,
    this.expectedProfitPercent, this.macroSentiment, this.fearGreed,
    this.fearGreedClass, this.aiAccuracy, this.generatedAt,
  });

  factory ActionReport.fromJson(Map<String, dynamic> j) {
    final a = j['action'] as Map<String, dynamic>? ?? j;
    return ActionReport(
      bestAsset:             a['bestAsset']?.toString()             ?? '',
      displayName:           a['displayName']?.toString()           ?? '',
      assetClass:            a['assetClass']?.toString()            ?? 'crypto',
      action:                a['action']?.toString()                ?? 'HOLD',
      timeframe:             a['timeframe']?.toString()             ?? '4H',
      confidence:            (a['confidence'] as num?)?.toInt()     ?? 0,
      reason:                a['reason']?.toString()                ?? '',
      totalEvaluated:        (a['totalEvaluated'] as num?)?.toInt() ?? 0,
      entryPrice:            (a['entryPrice']  as num?)?.toDouble(),
      stopLoss:              (a['stopLoss']    as num?)?.toDouble(),
      takeProfit:            (a['takeProfit']  as num?)?.toDouble(),
      riskReward:            a['riskReward']?.toString(),
      expectedProfitPercent: a['expectedProfitPercent']?.toString(),
      macroSentiment:        a['macroSentiment']?.toString(),
      fearGreed:             (a['fearGreed'] as num?)?.toInt(),
      fearGreedClass:        a['fearGreedClass']?.toString(),
      aiAccuracy:            (a['aiAccuracy'] as num?)?.toInt(),
      generatedAt:           j['generatedAt'] != null
          ? DateTime.tryParse(j['generatedAt'].toString()) : null,
      topPicks: (a['topPicks'] as List? ?? [])
          .map((p) => TopPick.fromJson(p as Map<String, dynamic>))
          .toList(),
    );
  }
}

// ── Report 2: Performance ────────────────────────────────────────────────────

class RecentDecision {
  final String   id;
  final String   asset;
  final String   displayName;
  final String   action;
  final int      confidence;
  final String   result;
  final double?  profitPct;
  final DateTime createdAt;

  const RecentDecision({
    required this.id, required this.asset, required this.displayName,
    required this.action, required this.confidence, required this.result,
    required this.createdAt, this.profitPct,
  });

  factory RecentDecision.fromJson(Map<String, dynamic> j) => RecentDecision(
    id:          j['id']?.toString()           ?? '',
    asset:       j['asset']?.toString()        ?? '',
    displayName: j['displayName']?.toString()  ?? j['asset']?.toString() ?? '',
    action:      j['action']?.toString()       ?? 'HOLD',
    confidence:  (j['confidence'] as num?)?.toInt()   ?? 0,
    result:      j['result']?.toString()       ?? 'OPEN',
    profitPct:   (j['profitPct'] as num?)?.toDouble(),
    createdAt:   DateTime.tryParse(j['createdAt']?.toString() ?? '') ?? DateTime.now(),
  );
}

class PerformanceReport {
  final double startingBalance;
  final double currentBalance;
  final double netProfit;
  final double netProfitPercent;
  final double last24hProfit;
  final double last7dProfit;
  final int    totalTrades;
  final int    winTrades;
  final int    lossTrades;
  final int    openTrades;
  final int    winRate;
  final int    accuracy;
  final List<EquityPoint>    equityCurve;
  final List<RecentDecision> recentDecisions;
  final String? message;

  const PerformanceReport({
    required this.startingBalance, required this.currentBalance,
    required this.netProfit, required this.netProfitPercent,
    required this.last24hProfit, required this.last7dProfit,
    required this.totalTrades, required this.winTrades, required this.lossTrades,
    required this.openTrades, required this.winRate, required this.accuracy,
    required this.equityCurve, required this.recentDecisions, this.message,
  });

  factory PerformanceReport.fromJson(Map<String, dynamic> j) => PerformanceReport(
    startingBalance:  (j['startingBalance']  as num?)?.toDouble() ?? 500,
    currentBalance:   (j['currentBalance']   as num?)?.toDouble() ?? 500,
    netProfit:        (j['netProfit']        as num?)?.toDouble() ?? 0,
    netProfitPercent: (j['netProfitPercent'] as num?)?.toDouble() ?? 0,
    last24hProfit:    (j['last24hProfit']    as num?)?.toDouble() ?? 0,
    last7dProfit:     (j['last7dProfit']     as num?)?.toDouble() ?? 0,
    totalTrades:      (j['totalTrades']      as num?)?.toInt()    ?? 0,
    winTrades:        (j['winTrades']        as num?)?.toInt()    ?? 0,
    lossTrades:       (j['lossTrades']       as num?)?.toInt()    ?? 0,
    openTrades:       (j['openTrades']       as num?)?.toInt()    ?? 0,
    winRate:          (j['winRate']          as num?)?.toInt()    ?? 0,
    accuracy:         (j['accuracy']         as num?)?.toInt()    ?? 0,
    message:          j['message']?.toString(),
    equityCurve:      (j['equityCurve'] as List? ?? [])
        .map((p) => EquityPoint.fromJson(p as Map<String, dynamic>))
        .toList(),
    recentDecisions:  (j['recentDecisions'] as List? ?? [])
        .map((d) => RecentDecision.fromJson(d as Map<String, dynamic>))
        .toList(),
  );
}

// ── Providers ────────────────────────────────────────────────────────────────

final brainActionProvider = FutureProvider.autoDispose<ActionReport>((ref) async {
  final resp = await ApiService.dio.get('brain/report/action');
  return ActionReport.fromJson(resp.data as Map<String, dynamic>);
});

final brainBalanceProvider = StateProvider<double>((ref) => 500.0);

final brainPerformanceProvider =
    FutureProvider.autoDispose.family<PerformanceReport, double>((ref, balance) async {
  final resp = await ApiService.dio.get('brain/report/performance',
      queryParameters: {'balance': balance});
  return PerformanceReport.fromJson(resp.data as Map<String, dynamic>);
});
