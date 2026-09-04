class DCAPurchase {
  final double price;
  final double amountUsd;
  final double units;
  final DateTime date;

  const DCAPurchase({
    required this.price,
    required this.amountUsd,
    required this.units,
    required this.date,
  });

  factory DCAPurchase.fromJson(Map<String, dynamic> j) => DCAPurchase(
        price:     (j['price']     ?? 0).toDouble(),
        amountUsd: (j['amountUsd'] ?? 0).toDouble(),
        units:     (j['units']     ?? 0).toDouble(),
        date:      DateTime.tryParse(j['date'] ?? '') ?? DateTime.now(),
      );
}

class DCAPlanModel {
  final String id;
  final String asset;
  final double amountPerBuy;
  final int frequencyDays;
  final String status;
  final List<DCAPurchase> purchases;
  final double totalInvested;
  final double totalUnits;
  final DateTime startedAt;
  final DateTime? lastBuyAt;
  final double? currentPrice;
  final double? currentValue;
  final double? unrealizedPnl;
  final double? unrealizedPnlPct;
  final double avgCostBasis;
  // Safety fix (2026-09-04, decision #11): the daily cron used to buy the
  // instant a plan came due, with no approval. Now it only sets this flag
  // -- true means there's a due buy sitting on this plan waiting for the
  // user to approve or skip it in the app.
  final bool dueBuyPending;

  const DCAPlanModel({
    required this.id,
    required this.asset,
    required this.amountPerBuy,
    required this.frequencyDays,
    required this.status,
    required this.purchases,
    required this.totalInvested,
    required this.totalUnits,
    required this.startedAt,
    this.lastBuyAt,
    this.currentPrice,
    this.currentValue,
    this.unrealizedPnl,
    this.unrealizedPnlPct,
    required this.avgCostBasis,
    this.dueBuyPending = false,
  });

  factory DCAPlanModel.fromJson(Map<String, dynamic> j) => DCAPlanModel(
        id:            j['_id'] ?? '',
        asset:         j['asset'] ?? '',
        amountPerBuy:  (j['amountPerBuy']  ?? 0).toDouble(),
        frequencyDays: (j['frequencyDays'] ?? 1) as int,
        status:        j['status'] ?? 'active',
        purchases: (j['purchases'] as List? ?? [])
            .map((e) => DCAPurchase.fromJson(e as Map<String, dynamic>))
            .toList(),
        totalInvested: (j['totalInvested'] ?? 0).toDouble(),
        totalUnits:    (j['totalUnits']    ?? 0).toDouble(),
        startedAt:     DateTime.tryParse(j['startedAt'] ?? '') ?? DateTime.now(),
        lastBuyAt:     j['lastBuyAt'] != null ? DateTime.tryParse(j['lastBuyAt']) : null,
        currentPrice:      (j['currentPrice']  as num?)?.toDouble(),
        currentValue:      (j['currentValue']  as num?)?.toDouble(),
        unrealizedPnl:     (j['unrealizedPnl'] as num?)?.toDouble(),
        unrealizedPnlPct:  (j['unrealizedPnlPct'] as num?)?.toDouble(),
        avgCostBasis:      (j['avgCostBasis'] ?? 0).toDouble(),
        dueBuyPending:     j['dueBuyPending'] as bool? ?? false,
      );

  bool get isActive => status == 'active';
}
