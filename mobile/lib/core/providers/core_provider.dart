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

// ── Providers ─────────────────────────────────────────────────────────────────

final coreAdviceProvider = FutureProvider.autoDispose<CoreAdvice>((ref) async {
  final resp = await ApiService.dio.get('core/advice');
  return CoreAdvice.fromJson(resp.data['advice'] as Map<String, dynamic>);
});

final coreSimProvider = FutureProvider.autoDispose.family<CoreSimResult, double>((ref, capital) async {
  final resp = await ApiService.dio.get('core/simulator', queryParameters: {'capital': capital});
  return CoreSimResult.fromJson(resp.data as Map<String, dynamic>);
});
