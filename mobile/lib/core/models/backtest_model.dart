class BacktestResultModel {
  final String asset;
  final String interval;
  final DateTime periodStart;
  final DateTime periodEnd;
  final int totalTrades;
  final int wins;
  final int losses;
  final double winRate;
  final double totalReturnPct;
  final double profitFactor;
  final double maxDrawdownPct;
  final double sharpeRatio;
  final double avgWinPct;
  final double avgLossPct;
  final double totalPnlUsd;

  const BacktestResultModel({
    required this.asset,
    required this.interval,
    required this.periodStart,
    required this.periodEnd,
    required this.totalTrades,
    required this.wins,
    required this.losses,
    required this.winRate,
    required this.totalReturnPct,
    required this.profitFactor,
    required this.maxDrawdownPct,
    required this.sharpeRatio,
    required this.avgWinPct,
    required this.avgLossPct,
    required this.totalPnlUsd,
  });

  factory BacktestResultModel.fromJson(Map<String, dynamic> j) => BacktestResultModel(
        asset:          j['asset']    ?? '',
        interval:       j['interval'] ?? '1h',
        periodStart:    DateTime.tryParse(j['period_start'] ?? '') ?? DateTime.now(),
        periodEnd:      DateTime.tryParse(j['period_end']   ?? '') ?? DateTime.now(),
        totalTrades:    (j['total_trades']     ?? 0) as int,
        wins:           (j['wins']             ?? 0) as int,
        losses:         (j['losses']           ?? 0) as int,
        winRate:        (j['win_rate']         ?? 0).toDouble(),
        totalReturnPct: (j['total_return_pct'] ?? 0).toDouble(),
        profitFactor:   (j['profit_factor']    ?? 0).toDouble(),
        maxDrawdownPct: (j['max_drawdown_pct'] ?? 0).toDouble(),
        sharpeRatio:    (j['sharpe_ratio']     ?? 0).toDouble(),
        avgWinPct:      (j['avg_win_pct']      ?? 0).toDouble(),
        avgLossPct:     (j['avg_loss_pct']     ?? 0).toDouble(),
        totalPnlUsd:    (j['total_pnl_usd']    ?? 0).toDouble(),
      );

  bool get isProfitable => totalReturnPct >= 0;
}
