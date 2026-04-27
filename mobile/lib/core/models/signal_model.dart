import 'package:equatable/equatable.dart';

class SignalPrice extends Equatable {
  final double entry;
  final double? stopLoss;
  final double? takeProfit;

  const SignalPrice({required this.entry, this.stopLoss, this.takeProfit});

  factory SignalPrice.fromJson(Map<String, dynamic> json) => SignalPrice(
    entry:      (json['entry'] ?? 0).toDouble(),
    stopLoss:   json['stopLoss'] != null ? (json['stopLoss']).toDouble() : null,
    takeProfit: json['takeProfit'] != null ? (json['takeProfit']).toDouble() : null,
  );

  double? get riskRewardRatio {
    if (stopLoss == null || takeProfit == null) return null;
    final risk   = (entry - stopLoss!).abs();
    final reward = (takeProfit! - entry).abs();
    return risk > 0 ? reward / risk : null;
  }

  @override
  List<Object?> get props => [entry, stopLoss, takeProfit];
}

class SignalSources extends Equatable {
  final double marketScore;
  final double newsScore;
  final double socialScore;

  const SignalSources({
    this.marketScore = 0,
    this.newsScore = 0,
    this.socialScore = 0,
  });

  factory SignalSources.fromJson(Map<String, dynamic> json) => SignalSources(
    marketScore: ((json['market']?['score']) ?? 0).toDouble(),
    newsScore:   ((json['news']?['score'])   ?? 0).toDouble(),
    socialScore: ((json['social']?['score']) ?? 0).toDouble(),
  );

  @override
  List<Object?> get props => [marketScore, newsScore, socialScore];
}

class SignalModel extends Equatable {
  final String id;
  final String asset;
  final String direction; // BUY | SELL | HOLD
  final double confidence;
  final SignalPrice price;
  final String reason;
  final SignalSources sources;
  final String status;
  final DateTime createdAt;

  const SignalModel({
    required this.id,
    required this.asset,
    required this.direction,
    required this.confidence,
    required this.price,
    required this.reason,
    required this.sources,
    required this.status,
    required this.createdAt,
  });

  factory SignalModel.fromJson(Map<String, dynamic> json) => SignalModel(
    id:         json['_id'] ?? '',
    asset:      json['asset'] ?? '',
    direction:  json['direction'] ?? 'HOLD',
    confidence: (json['confidence'] ?? 0).toDouble(),
    price:      SignalPrice.fromJson(json['price'] ?? {}),
    reason:     json['reason'] ?? '',
    sources:    SignalSources.fromJson(json['sources'] ?? {}),
    status:     json['status'] ?? 'active',
    createdAt:  DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
  );

  bool get isBuy  => direction == 'BUY';
  bool get isSell => direction == 'SELL';

  String get confidenceBar {
    final filled = (confidence / 10).round().clamp(0, 10);
    return '█' * filled + '░' * (10 - filled);
  }

  String get baseAsset {
    if (asset.endsWith('USDT')) return asset.replaceAll('USDT', '');
    if (asset.endsWith('USD'))  return asset.replaceAll('USD', '');
    if (asset.contains('/'))    return asset.split('/').first;
    return asset;
  }

  @override
  List<Object?> get props => [id, asset, direction, confidence, status, createdAt];
}
