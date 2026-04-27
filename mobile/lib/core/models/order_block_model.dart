class OBZone {
  final double low;
  final double high;
  const OBZone({required this.low, required this.high});

  factory OBZone.fromJson(Map<String, dynamic> j) =>
      OBZone(low: (j['low'] as num).toDouble(), high: (j['high'] as num).toDouble());
}

class OrderBlock {
  final String type;       // bullish | bearish
  final OBZone zone;
  final int    strength;   // 0-100
  final String freshness;  // fresh | mitigated
  final String timeframe;
  final String timestamp;

  const OrderBlock({
    required this.type, required this.zone, required this.strength,
    required this.freshness, required this.timeframe, required this.timestamp,
  });

  factory OrderBlock.fromJson(Map<String, dynamic> j) => OrderBlock(
    type:      j['type'] as String,
    zone:      OBZone.fromJson(j['zone'] as Map<String, dynamic>),
    strength:  (j['strength'] as num).toInt(),
    freshness: j['freshness'] as String,
    timeframe: j['timeframe'] as String,
    timestamp: j['timestamp'] as String? ?? '',
  );

  bool get isBullish => type == 'bullish';
}

class OBSignal {
  final String  action;       // BUY | SELL | HOLD
  final int     confidence;
  final String? entryZone;
  final double? stopLoss;
  final double? takeProfit;
  final String? riskReward;
  final String  reason;

  const OBSignal({
    required this.action, required this.confidence, required this.reason,
    this.entryZone, this.stopLoss, this.takeProfit, this.riskReward,
  });

  factory OBSignal.fromJson(Map<String, dynamic> j) => OBSignal(
    action:     j['action'] as String,
    confidence: (j['confidence'] as num).toInt(),
    entryZone:  j['entry_zone'] as String?,
    stopLoss:   (j['stop_loss']   as num?)?.toDouble(),
    takeProfit: (j['take_profit'] as num?)?.toDouble(),
    riskReward: j['risk_reward'] as String?,
    reason:     j['reason'] as String? ?? '',
  );
}

class OrderBlockResult {
  final String        asset;
  final String        timeframe;
  final double        currentPrice;
  final double        ema50;
  final double        ema200;
  final double        rsi;
  final String        trend;
  final List<OrderBlock> orderBlocks;
  final OBSignal      signal;

  const OrderBlockResult({
    required this.asset, required this.timeframe, required this.currentPrice,
    required this.ema50, required this.ema200, required this.rsi,
    required this.trend, required this.orderBlocks, required this.signal,
  });

  factory OrderBlockResult.fromJson(Map<String, dynamic> j) => OrderBlockResult(
    asset:        j['asset'] as String,
    timeframe:    j['timeframe'] as String,
    currentPrice: (j['current_price'] as num).toDouble(),
    ema50:        (j['ema50'] as num).toDouble(),
    ema200:       (j['ema200'] as num).toDouble(),
    rsi:          (j['rsi'] as num).toDouble(),
    trend:        j['trend'] as String,
    orderBlocks:  (j['order_blocks'] as List)
        .map((e) => OrderBlock.fromJson(e as Map<String, dynamic>))
        .toList(),
    signal:       OBSignal.fromJson(j['signal'] as Map<String, dynamic>),
  );
}
