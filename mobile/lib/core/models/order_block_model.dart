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

class OBNewsAnalysis {
  final double        newsScore;       // 0-100 bullish scale from news
  final double        socialScore;     // 0-100 bullish scale from social
  final double        combinedScore;   // average of news+social
  final String        sentiment;       // bullish | bearish | neutral
  final double        impact;
  final int           articleCount;
  final List<String>  topEvents;
  final bool          aligned;         // does news align with signal?
  final int           confidenceBoost; // how much added/subtracted
  final int           technicalConfidence; // OB-only confidence before fusion

  const OBNewsAnalysis({
    required this.newsScore, required this.socialScore,
    required this.combinedScore, required this.sentiment,
    required this.impact, required this.articleCount, required this.topEvents,
    required this.aligned, required this.confidenceBoost,
    required this.technicalConfidence,
  });

  static const empty = OBNewsAnalysis(
    newsScore: 50, socialScore: 50, combinedScore: 50, sentiment: 'neutral',
    impact: 0, articleCount: 0, topEvents: [], aligned: false,
    confidenceBoost: 0, technicalConfidence: 50,
  );

  factory OBNewsAnalysis.fromJson(Map<String, dynamic> j) => OBNewsAnalysis(
    newsScore:            (j['news_score']    as num?)?.toDouble() ?? 50,
    socialScore:          (j['social_score']  as num?)?.toDouble() ?? 50,
    combinedScore:        (j['combined_score'] as num?)?.toDouble() ?? 50,
    sentiment:            j['sentiment']      as String? ?? 'neutral',
    impact:               (j['impact']        as num?)?.toDouble() ?? 0.0,
    articleCount:         (j['article_count'] as num?)?.toInt()    ?? 0,
    topEvents:            (j['top_events']    as List?)?.cast<String>() ?? const [],
    aligned:              j['aligned']        as bool?  ?? false,
    confidenceBoost:      (j['confidence_boost']      as num?)?.toInt() ?? 0,
    technicalConfidence:  (j['technical_confidence']  as num?)?.toInt() ?? 50,
  );
}

class OrderBlockResult {
  final String           asset;
  final String           timeframe;
  final double           currentPrice;
  final double           ema50;
  final double           ema200;
  final double           rsi;
  final String           trend;
  final List<OrderBlock> orderBlocks;
  final OBSignal         signal;
  final OBNewsAnalysis   newsAnalysis;

  const OrderBlockResult({
    required this.asset, required this.timeframe, required this.currentPrice,
    required this.ema50, required this.ema200, required this.rsi,
    required this.trend, required this.orderBlocks, required this.signal,
    this.newsAnalysis = OBNewsAnalysis.empty,
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
    newsAnalysis: j['news_analysis'] != null
        ? OBNewsAnalysis.fromJson(j['news_analysis'] as Map<String, dynamic>)
        : OBNewsAnalysis.empty,
  );
}
