import 'package:equatable/equatable.dart';

class BalancePoint extends Equatable {
  final DateTime date;
  final double balance;

  const BalancePoint({required this.date, required this.balance});

  factory BalancePoint.fromJson(Map<String, dynamic> j) => BalancePoint(
        date:    DateTime.tryParse(j['date'] ?? '') ?? DateTime.now(),
        balance: (j['balance'] ?? 0).toDouble(),
      );

  @override
  List<Object?> get props => [date, balance];
}

class TradeSnapshot extends Equatable {
  final double  pnl;
  final String  asset;
  final String  direction;
  final DateTime? closedAt;

  const TradeSnapshot({
    required this.pnl,
    required this.asset,
    required this.direction,
    this.closedAt,
  });

  factory TradeSnapshot.fromJson(Map<String, dynamic> j) => TradeSnapshot(
        pnl:       (j['pnl'] ?? 0).toDouble(),
        asset:     j['asset']     ?? '',
        direction: j['direction'] ?? '',
        closedAt:  j['closedAt'] != null ? DateTime.tryParse(j['closedAt']) : null,
      );

  @override
  List<Object?> get props => [pnl, asset, direction, closedAt];
}

class VirtualPerformanceModel extends Equatable {
  final double startingBalance;
  final double currentBalance;
  final double riskPerTradePct;
  final double netProfit;
  final double netProfitPct;
  final double totalProfit;
  final double totalLoss;
  final int    winCount;
  final int    lossCount;
  final int    totalTrades;
  final int    openTrades;
  final double winRate;
  final int    avgDurationMinutes;
  final double maxDrawdown;
  final double peakBalance;
  final TradeSnapshot? bestTrade;
  final TradeSnapshot? worstTrade;
  final List<BalancePoint> balanceHistory;
  final String range;
  final DateTime? startedAt;
  final DateTime? updatedAt;

  const VirtualPerformanceModel({
    required this.startingBalance,
    required this.currentBalance,
    required this.riskPerTradePct,
    required this.netProfit,
    required this.netProfitPct,
    required this.totalProfit,
    required this.totalLoss,
    required this.winCount,
    required this.lossCount,
    required this.totalTrades,
    required this.openTrades,
    required this.winRate,
    required this.avgDurationMinutes,
    required this.maxDrawdown,
    required this.peakBalance,
    this.bestTrade,
    this.worstTrade,
    required this.balanceHistory,
    this.range = 'all',
    this.startedAt,
    this.updatedAt,
  });

  factory VirtualPerformanceModel.fromJson(Map<String, dynamic> j) =>
      VirtualPerformanceModel(
        startingBalance:    (j['startingBalance']    ?? 500).toDouble(),
        currentBalance:     (j['currentBalance']     ?? 500).toDouble(),
        riskPerTradePct:    (j['riskPerTradePct']    ?? 5).toDouble(),
        netProfit:          (j['netProfit']           ?? 0).toDouble(),
        netProfitPct:       (j['netProfitPct']        ?? 0).toDouble(),
        totalProfit:        (j['totalProfit']         ?? 0).toDouble(),
        totalLoss:          (j['totalLoss']           ?? 0).toDouble(),
        winCount:           (j['winCount']            ?? 0) as int,
        lossCount:          (j['lossCount']           ?? 0) as int,
        totalTrades:        (j['totalTrades']         ?? 0) as int,
        openTrades:         (j['openTrades']          ?? 0) as int,
        winRate:            (j['winRate']             ?? 0).toDouble(),
        avgDurationMinutes: (j['avgDurationMinutes']  ?? 0) as int,
        maxDrawdown:        (j['maxDrawdown']         ?? 0).toDouble(),
        peakBalance:        (j['peakBalance']         ?? 500).toDouble(),
        bestTrade:          j['bestTrade']  != null
            ? TradeSnapshot.fromJson(j['bestTrade']  as Map<String, dynamic>)
            : null,
        worstTrade:         j['worstTrade'] != null
            ? TradeSnapshot.fromJson(j['worstTrade'] as Map<String, dynamic>)
            : null,
        balanceHistory: (j['balanceHistory'] as List? ?? [])
            .map((e) => BalancePoint.fromJson(e as Map<String, dynamic>))
            .toList(),
        range:     j['range']     ?? 'all',
        startedAt: j['startedAt'] != null ? DateTime.tryParse(j['startedAt']) : null,
        updatedAt: j['updatedAt'] != null ? DateTime.tryParse(j['updatedAt']) : null,
      );

  bool get isProfitable => netProfit >= 0;

  double get returnPct => startingBalance > 0
      ? (netProfit / startingBalance) * 100
      : 0;

  @override
  List<Object?> get props => [currentBalance, netProfit, totalTrades, winRate, range];
}

class VirtualTradeModel extends Equatable {
  final String  id;
  final String  signalId;
  final String  asset;
  final String  direction;
  final double  entryPrice;
  final double? stopLoss;
  final double? takeProfit;
  final double  sizeUsd;
  final String  status;
  final String? result;
  final String? exitReason;
  final double? exitPrice;
  final double? pnl;
  final double? pnlPct;
  final double? balanceBefore;
  final double? balanceAfter;
  final int?    durationMinutes;
  final DateTime openedAt;
  final DateTime? closedAt;

  const VirtualTradeModel({
    required this.id,
    required this.signalId,
    required this.asset,
    required this.direction,
    required this.entryPrice,
    this.stopLoss,
    this.takeProfit,
    required this.sizeUsd,
    required this.status,
    this.result,
    this.exitReason,
    this.exitPrice,
    this.pnl,
    this.pnlPct,
    this.balanceBefore,
    this.balanceAfter,
    this.durationMinutes,
    required this.openedAt,
    this.closedAt,
  });

  factory VirtualTradeModel.fromJson(Map<String, dynamic> j) => VirtualTradeModel(
        id:             j['_id']        ?? '',
        signalId:       j['signalId']   ?? '',
        asset:          j['asset']      ?? '',
        direction:      j['direction']  ?? 'BUY',
        entryPrice:     (j['entryPrice']  ?? 0).toDouble(),
        stopLoss:       j['stopLoss']   != null ? (j['stopLoss']).toDouble()   : null,
        takeProfit:     j['takeProfit'] != null ? (j['takeProfit']).toDouble() : null,
        sizeUsd:        (j['sizeUsd']   ?? 0).toDouble(),
        status:         j['status']     ?? 'open',
        result:         j['result'],
        exitReason:     j['exitReason'],
        exitPrice:      j['exitPrice']      != null ? (j['exitPrice']).toDouble()      : null,
        pnl:            j['pnl']            != null ? (j['pnl']).toDouble()            : null,
        pnlPct:         j['pnlPct']         != null ? (j['pnlPct']).toDouble()         : null,
        balanceBefore:  j['balanceBefore']  != null ? (j['balanceBefore']).toDouble()  : null,
        balanceAfter:   j['balanceAfter']   != null ? (j['balanceAfter']).toDouble()   : null,
        durationMinutes: j['durationMinutes'] != null ? (j['durationMinutes']) as int  : null,
        openedAt:       DateTime.tryParse(j['openedAt'] ?? '') ?? DateTime.now(),
        closedAt:       j['closedAt'] != null ? DateTime.tryParse(j['closedAt']) : null,
      );

  bool get isOpen   => status == 'open';
  bool get isWin    => result == 'win';
  bool get isLoss   => result == 'loss';
  bool get isBuy    => direction == 'BUY';

  String get baseAsset {
    if (asset.endsWith('USDT')) return asset.replaceAll('USDT', '');
    if (asset.endsWith('USD'))  return asset.replaceAll('USD', '');
    return asset;
  }

  String get durationLabel {
    if (durationMinutes == null) return '';
    if (durationMinutes! < 60)   return '${durationMinutes}m';
    final h = durationMinutes! ~/ 60;
    final m = durationMinutes! % 60;
    return m == 0 ? '${h}h' : '${h}h ${m}m';
  }

  @override
  List<Object?> get props => [id, status, pnl];
}
