import 'package:equatable/equatable.dart';

class AssetRecommendation extends Equatable {
  final String  asset;
  final String  recommendation; // BUY | SELL | HOLD
  final String  trend;
  final int     confidence;
  final double  expectedMovePercent;
  final double  currentPrice;
  final String  reason;
  // simulation extras
  final double? initialCapital;
  final double? finalBalance;
  final double? profit;
  final double? loss;
  final int?    trades;
  final double? returnPct;

  const AssetRecommendation({
    required this.asset,
    required this.recommendation,
    required this.trend,
    required this.confidence,
    required this.expectedMovePercent,
    required this.currentPrice,
    required this.reason,
    this.initialCapital,
    this.finalBalance,
    this.profit,
    this.loss,
    this.trades,
    this.returnPct,
  });

  factory AssetRecommendation.fromJson(Map<String, dynamic> j) =>
      AssetRecommendation(
        asset:               j['asset']                ?? '',
        recommendation:      j['recommendation']       ?? 'HOLD',
        trend:               j['trend']                ?? 'unknown',
        confidence:          (j['confidence']          ?? 50) as int,
        expectedMovePercent: (j['expected_move_percent'] ?? j['expectedMove'] ?? 0).toDouble(),
        currentPrice:        (j['current_price']       ?? j['currentPrice'] ?? 0).toDouble(),
        reason:              j['reason']               ?? '',
        initialCapital:      j['initial_capital']  != null ? (j['initial_capital']).toDouble()  : null,
        finalBalance:        j['final_balance']    != null ? (j['final_balance']).toDouble()    : null,
        profit:              j['profit']           != null ? (j['profit']).toDouble()           : null,
        loss:                j['loss']             != null ? (j['loss']).toDouble()             : null,
        trades:              j['trades']           != null ? (j['trades'])  as int              : null,
        returnPct:           j['return_pct']       != null ? (j['return_pct']).toDouble()       : null,
      );

  String get baseAsset {
    if (asset.endsWith('USDT')) return asset.replaceAll('USDT', '');
    return asset;
  }

  @override
  List<Object?> get props => [asset, recommendation, confidence];
}

// ─── Holding result ───────────────────────────────────────────────────────────

class HoldingResult extends Equatable {
  final String?  bestAsset;
  final String?  bestRec;
  final List<AssetRecommendation> recommendations;
  final double   expectedProfit;
  final double   expectedLoss;
  final double   winRate;
  final double   capital;
  final String   timeframe;

  const HoldingResult({
    this.bestAsset,
    this.bestRec,
    required this.recommendations,
    required this.expectedProfit,
    required this.expectedLoss,
    required this.winRate,
    required this.capital,
    required this.timeframe,
  });

  factory HoldingResult.fromJson(Map<String, dynamic> j) => HoldingResult(
        bestAsset:       j['best_asset'],
        bestRec:         j['best_rec'],
        recommendations: (j['recommendations'] as List? ?? [])
            .map((e) => AssetRecommendation.fromJson(e as Map<String, dynamic>))
            .toList(),
        expectedProfit: (j['expected_profit'] ?? 0).toDouble(),
        expectedLoss:   (j['expected_loss']   ?? 0).toDouble(),
        winRate:        (j['win_rate']         ?? 0).toDouble(),
        capital:        (j['capital']          ?? 500).toDouble(),
        timeframe:      j['timeframe']         ?? '7d',
      );

  @override
  List<Object?> get props => [bestAsset, winRate, recommendations.length];
}

// ─── Simulation result ────────────────────────────────────────────────────────

class SimulationResult extends Equatable {
  final double   initialBalance;
  final double   finalBalance;
  final double   profit;
  final double   loss;
  final double   netPnl;
  final double   returnPct;
  final double   winRate;
  final int      totalTrades;
  final String   timeframe;
  final List<AssetRecommendation> perAsset;

  const SimulationResult({
    required this.initialBalance,
    required this.finalBalance,
    required this.profit,
    required this.loss,
    required this.netPnl,
    required this.returnPct,
    required this.winRate,
    required this.totalTrades,
    required this.timeframe,
    required this.perAsset,
  });

  factory SimulationResult.fromJson(Map<String, dynamic> j) => SimulationResult(
        initialBalance: (j['initial_balance'] ?? 500).toDouble(),
        finalBalance:   (j['final_balance']   ?? 500).toDouble(),
        profit:         (j['profit']           ?? 0).toDouble(),
        loss:           (j['loss']             ?? 0).toDouble(),
        netPnl:         (j['net_pnl']          ?? 0).toDouble(),
        returnPct:      (j['return_pct']       ?? 0).toDouble(),
        winRate:        (j['win_rate']         ?? 0).toDouble(),
        totalTrades:    (j['total_trades']     ?? 0) as int,
        timeframe:      j['timeframe']         ?? '7d',
        perAsset:       (j['per_asset'] as List? ?? [])
            .map((e) => AssetRecommendation.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  bool get isProfitable => netPnl >= 0;

  @override
  List<Object?> get props => [netPnl, totalTrades, winRate];
}
