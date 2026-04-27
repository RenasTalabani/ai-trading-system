class PnLModel {
  final double profit;
  final double loss;
  final double net;
  final double winRate;
  final int trades;

  const PnLModel({
    required this.profit,
    required this.loss,
    required this.net,
    required this.winRate,
    required this.trades,
  });

  factory PnLModel.fromJson(Map<String, dynamic> j) => PnLModel(
        profit: (j['profit'] as num).toDouble(),
        loss: (j['loss'] as num).toDouble(),
        net: (j['net'] as num).toDouble(),
        winRate: (j['winRate'] as num).toDouble(),
        trades: (j['trades'] as num).toInt(),
      );

  static const empty = PnLModel(
    profit: 0,
    loss: 0,
    net: 0,
    winRate: 0,
    trades: 0,
  );
}
