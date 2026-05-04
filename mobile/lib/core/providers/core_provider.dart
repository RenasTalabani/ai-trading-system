import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

// ── Models ────────────────────────────────────────────────────────────────────

class CoreAdvice {
  final String  asset;
  final String  displayName;
  final String  decision;       // BUY | SELL | HOLD
  final String  timeframe;
  final int     confidence;
  final String  expectedProfit;
  final String  reason;
  final double? currentPrice;
  final double? stopLoss;
  final double? takeProfit;
  final String? riskReward;
  final String  assetClass;
  final DateTime? scannedAt;

  const CoreAdvice({
    required this.asset,
    required this.displayName,
    required this.decision,
    required this.timeframe,
    required this.confidence,
    required this.expectedProfit,
    required this.reason,
    required this.assetClass,
    this.currentPrice,
    this.stopLoss,
    this.takeProfit,
    this.riskReward,
    this.scannedAt,
  });

  factory CoreAdvice.fromJson(Map<String, dynamic> j) => CoreAdvice(
    asset:          j['asset']?.toString()          ?? '',
    displayName:    j['display_name']?.toString()   ?? j['asset']?.toString() ?? '',
    decision:       j['decision']?.toString()        ?? 'HOLD',
    timeframe:      j['timeframe']?.toString()       ?? '1h',
    confidence:     (j['confidence'] as num?)?.toInt() ?? 0,
    expectedProfit: j['expected_profit']?.toString() ?? 'N/A',
    reason:         j['reason']?.toString()           ?? '',
    assetClass:     j['asset_class']?.toString()      ?? 'crypto',
    currentPrice:   (j['current_price'] as num?)?.toDouble(),
    stopLoss:       (j['stop_loss']     as num?)?.toDouble(),
    takeProfit:     (j['take_profit']   as num?)?.toDouble(),
    riskReward:     j['risk_reward']?.toString(),
    scannedAt:      j['scanned_at'] != null
        ? DateTime.tryParse(j['scanned_at'].toString())
        : null,
  );
}

class CoreSimResult {
  final double capital;
  final double balance;
  final double profit;
  final double profitPercent;
  final int    winRate;
  final int    totalTrades;
  final int    wins;
  final int    losses;
  final String? message;

  const CoreSimResult({
    required this.capital,
    required this.balance,
    required this.profit,
    required this.profitPercent,
    required this.winRate,
    required this.totalTrades,
    required this.wins,
    required this.losses,
    this.message,
  });

  factory CoreSimResult.fromJson(Map<String, dynamic> j) => CoreSimResult(
    capital:       (j['capital']        as num?)?.toDouble() ?? 500,
    balance:       (j['balance']        as num?)?.toDouble() ?? 500,
    profit:        (j['profit']         as num?)?.toDouble() ?? 0,
    profitPercent: (j['profit_percent'] as num?)?.toDouble() ?? 0,
    winRate:       (j['win_rate']       as num?)?.toInt()    ?? 0,
    totalTrades:   (j['total_trades']   as num?)?.toInt()    ?? 0,
    wins:          (j['wins']           as num?)?.toInt()    ?? 0,
    losses:        (j['losses']         as num?)?.toInt()    ?? 0,
    message:       j['message']?.toString(),
  );
}

// ── Decision history model ────────────────────────────────────────────────────

class DecisionSummary {
  final int total;
  final int wins;
  final int losses;
  final int open;
  final int winRate;
  const DecisionSummary({
    required this.total, required this.wins,
    required this.losses, required this.open, required this.winRate,
  });
  factory DecisionSummary.fromJson(Map<String, dynamic> j) => DecisionSummary(
    total:   (j['total']    as num?)?.toInt() ?? 0,
    wins:    (j['wins']     as num?)?.toInt() ?? 0,
    losses:  (j['losses']   as num?)?.toInt() ?? 0,
    open:    (j['open']     as num?)?.toInt() ?? 0,
    winRate: (j['win_rate'] as num?)?.toInt() ?? 0,
  );
}

class DecisionRecord {
  final String  id;
  final String  asset;
  final String  displayName;
  final String  decision;
  final int     confidence;
  final String  timeframe;
  final double? entryPrice;
  final double? exitPrice;
  final double? profitPct;
  final double? profit;
  final String  result;       // WIN | LOSS | OPEN
  final String  reason;
  final DateTime createdAt;
  final DateTime? closedAt;

  const DecisionRecord({
    required this.id, required this.asset, required this.displayName,
    required this.decision, required this.confidence, required this.timeframe,
    required this.result, required this.reason, required this.createdAt,
    this.entryPrice, this.exitPrice, this.profitPct, this.profit, this.closedAt,
  });

  factory DecisionRecord.fromJson(Map<String, dynamic> j) => DecisionRecord(
    id:          j['id']?.toString()           ?? '',
    asset:       j['asset']?.toString()        ?? '',
    displayName: j['display_name']?.toString() ?? j['asset']?.toString() ?? '',
    decision:    j['decision']?.toString()     ?? 'HOLD',
    confidence:  (j['confidence'] as num?)?.toInt()   ?? 0,
    timeframe:   j['timeframe']?.toString()    ?? '1h',
    result:      j['result']?.toString()       ?? 'OPEN',
    reason:      j['reason']?.toString()       ?? '',
    entryPrice:  (j['entry_price'] as num?)?.toDouble(),
    exitPrice:   (j['exit_price']  as num?)?.toDouble(),
    profitPct:   (j['profit_pct']  as num?)?.toDouble(),
    profit:      (j['profit']      as num?)?.toDouble(),
    createdAt:   DateTime.tryParse(j['created_at']?.toString() ?? '') ?? DateTime.now(),
    closedAt:    j['closed_at'] != null
        ? DateTime.tryParse(j['closed_at'].toString()) : null,
  );
}

class CoreDecisionsData {
  final DecisionSummary summary;
  final List<DecisionRecord> decisions;
  const CoreDecisionsData({required this.summary, required this.decisions});
}

// ── Providers ─────────────────────────────────────────────────────────────────

final coreAdviceProvider = FutureProvider.autoDispose<CoreAdvice>((ref) async {
  final resp = await ApiService.dio.get('core/advice');
  return CoreAdvice.fromJson(resp.data['advice'] as Map<String, dynamic>);
});

final coreSimProvider = FutureProvider.autoDispose.family<CoreSimResult, double>((ref, capital) async {
  final resp = await ApiService.dio.get('core/simulator', queryParameters: {'capital': capital});
  return CoreSimResult.fromJson(resp.data as Map<String, dynamic>);
});

final coreDecisionsProvider = FutureProvider.autoDispose<CoreDecisionsData>((ref) async {
  final resp = await ApiService.dio.get('core/decisions');
  final summary = DecisionSummary.fromJson(resp.data['summary'] as Map<String, dynamic>);
  final list = (resp.data['decisions'] as List)
      .map((d) => DecisionRecord.fromJson(d as Map<String, dynamic>))
      .toList();
  return CoreDecisionsData(summary: summary, decisions: list);
});
