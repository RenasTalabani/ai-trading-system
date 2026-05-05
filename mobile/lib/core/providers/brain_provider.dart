import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../services/api_service.dart';
import 'core_provider.dart' show EquityPoint;

// ── Report 1: What To Do ─────────────────────────────────────────────────────

class TopPick {
  final String asset;
  final String displayName;
  final String action;
  final int    confidence;
  final String assetClass;
  const TopPick({
    required this.asset, required this.displayName,
    required this.action, required this.confidence, required this.assetClass,
  });
  factory TopPick.fromJson(Map<String, dynamic> j) => TopPick(
    asset:       j['asset']?.toString()       ?? '',
    displayName: j['displayName']?.toString() ?? j['asset']?.toString() ?? '',
    action:      j['action']?.toString()      ?? 'HOLD',
    confidence:  (j['confidence'] as num?)?.toInt() ?? 0,
    assetClass:  j['assetClass']?.toString()  ?? 'crypto',
  );
}

class ActionReport {
  final String   bestAsset;
  final String   displayName;
  final String   assetClass;
  final String   action;
  final double?  entryPrice;
  final double?  stopLoss;
  final double?  takeProfit;
  final String?  riskReward;
  final String   timeframe;
  final int      confidence;
  final String?  expectedProfitPercent;
  final String   reason;
  final List<TopPick> topPicks;
  final String?  macroSentiment;
  final int?     fearGreed;
  final String?  fearGreedClass;
  final int?     aiAccuracy;
  final int      totalEvaluated;
  final DateTime? generatedAt;

  const ActionReport({
    required this.bestAsset, required this.displayName, required this.assetClass,
    required this.action, required this.timeframe, required this.confidence,
    required this.reason, required this.topPicks, required this.totalEvaluated,
    this.entryPrice, this.stopLoss, this.takeProfit, this.riskReward,
    this.expectedProfitPercent, this.macroSentiment, this.fearGreed,
    this.fearGreedClass, this.aiAccuracy, this.generatedAt,
  });

  factory ActionReport.fromJson(Map<String, dynamic> j) {
    final a = j['action'] as Map<String, dynamic>? ?? j;
    return ActionReport(
      bestAsset:             a['bestAsset']?.toString()             ?? '',
      displayName:           a['displayName']?.toString()           ?? '',
      assetClass:            a['assetClass']?.toString()            ?? 'crypto',
      action:                a['action']?.toString()                ?? 'HOLD',
      timeframe:             a['timeframe']?.toString()             ?? '4H',
      confidence:            (a['confidence'] as num?)?.toInt()     ?? 0,
      reason:                a['reason']?.toString()                ?? '',
      totalEvaluated:        (a['totalEvaluated'] as num?)?.toInt() ?? 0,
      entryPrice:            (a['entryPrice']  as num?)?.toDouble(),
      stopLoss:              (a['stopLoss']    as num?)?.toDouble(),
      takeProfit:            (a['takeProfit']  as num?)?.toDouble(),
      riskReward:            a['riskReward']?.toString(),
      expectedProfitPercent: a['expectedProfitPercent']?.toString(),
      macroSentiment:        a['macroSentiment']?.toString(),
      fearGreed:             (a['fearGreed'] as num?)?.toInt(),
      fearGreedClass:        a['fearGreedClass']?.toString(),
      aiAccuracy:            (a['aiAccuracy'] as num?)?.toInt(),
      generatedAt:           j['generatedAt'] != null
          ? DateTime.tryParse(j['generatedAt'].toString()) : null,
      topPicks: (a['topPicks'] as List? ?? [])
          .map((p) => TopPick.fromJson(p as Map<String, dynamic>))
          .toList(),
    );
  }
}

// ── Report 2: Performance ────────────────────────────────────────────────────

class RecentDecision {
  final String   id;
  final String   asset;
  final String   displayName;
  final String   action;
  final int      confidence;
  final String   result;
  final double?  profitPct;
  final DateTime createdAt;

  const RecentDecision({
    required this.id, required this.asset, required this.displayName,
    required this.action, required this.confidence, required this.result,
    required this.createdAt, this.profitPct,
  });

  factory RecentDecision.fromJson(Map<String, dynamic> j) => RecentDecision(
    id:          j['id']?.toString()           ?? '',
    asset:       j['asset']?.toString()        ?? '',
    displayName: j['displayName']?.toString()  ?? j['asset']?.toString() ?? '',
    action:      j['action']?.toString()       ?? 'HOLD',
    confidence:  (j['confidence'] as num?)?.toInt()   ?? 0,
    result:      j['result']?.toString()       ?? 'OPEN',
    profitPct:   (j['profitPct'] as num?)?.toDouble(),
    createdAt:   DateTime.tryParse(j['createdAt']?.toString() ?? '') ?? DateTime.now(),
  );
}

class PerformanceReport {
  final double startingBalance;
  final double currentBalance;
  final double netProfit;
  final double netProfitPercent;
  final double last24hProfit;
  final double last7dProfit;
  final int    totalTrades;
  final int    winTrades;
  final int    lossTrades;
  final int    openTrades;
  final int    winRate;
  final int    accuracy;
  final double? avgProfitPct;
  final List<EquityPoint>    equityCurve;
  final List<RecentDecision> recentDecisions;
  final String? message;

  const PerformanceReport({
    required this.startingBalance, required this.currentBalance,
    required this.netProfit, required this.netProfitPercent,
    required this.last24hProfit, required this.last7dProfit,
    required this.totalTrades, required this.winTrades, required this.lossTrades,
    required this.openTrades, required this.winRate, required this.accuracy,
    required this.equityCurve, required this.recentDecisions,
    this.avgProfitPct, this.message,
  });

  factory PerformanceReport.fromJson(Map<String, dynamic> j) => PerformanceReport(
    startingBalance:  (j['startingBalance']  as num?)?.toDouble() ?? 500,
    currentBalance:   (j['currentBalance']   as num?)?.toDouble() ?? 500,
    netProfit:        (j['netProfit']        as num?)?.toDouble() ?? 0,
    netProfitPercent: (j['netProfitPercent'] as num?)?.toDouble() ?? 0,
    last24hProfit:    (j['last24hProfit']    as num?)?.toDouble() ?? 0,
    last7dProfit:     (j['last7dProfit']     as num?)?.toDouble() ?? 0,
    totalTrades:      (j['totalTrades']      as num?)?.toInt()    ?? 0,
    winTrades:        (j['winTrades']        as num?)?.toInt()    ?? 0,
    lossTrades:       (j['lossTrades']       as num?)?.toInt()    ?? 0,
    openTrades:       (j['openTrades']       as num?)?.toInt()    ?? 0,
    winRate:          (j['winRate']          as num?)?.toInt()    ?? 0,
    accuracy:         (j['accuracy']         as num?)?.toInt()    ?? 0,
    avgProfitPct:     (j['avgProfitPct']     as num?)?.toDouble(),
    message:          j['message']?.toString(),
    equityCurve:      (j['equityCurve'] as List? ?? [])
        .map((p) => EquityPoint.fromJson(p as Map<String, dynamic>))
        .toList(),
    recentDecisions:  (j['recentDecisions'] as List? ?? [])
        .map((d) => RecentDecision.fromJson(d as Map<String, dynamic>))
        .toList(),
  );
}

// ── Providers ────────────────────────────────────────────────────────────────

final brainActionProvider = FutureProvider.autoDispose<ActionReport>((ref) async {
  final resp = await ApiService.dio.get('brain/report/action');
  return ActionReport.fromJson(resp.data as Map<String, dynamic>);
});

// Live price for a given asset symbol — auto-refreshes every 30s
final livePriceProvider =
    FutureProvider.autoDispose.family<double?, String>((ref, asset) async {
  if (asset.isEmpty) return null;
  try {
    final resp = await ApiService.dio.get('market/price/$asset');
    return (resp.data['price'] as num?)?.toDouble();
  } catch (_) {
    return null;
  }
});

class _CapitalNotifier extends StateNotifier<double> {
  static const _key = 'brain_capital';
  static const _storage = FlutterSecureStorage();

  _CapitalNotifier() : super(500.0) { _load(); }

  Future<void> _load() async {
    final saved = await _storage.read(key: _key);
    if (saved != null) {
      final v = double.tryParse(saved);
      if (v != null) state = v;
    }
  }

  Future<void> set(double value) async {
    state = value;
    await _storage.write(key: _key, value: '$value');
  }
}

final brainBalanceProvider =
    StateNotifierProvider<_CapitalNotifier, double>((_) => _CapitalNotifier());

final brainPerformanceProvider =
    FutureProvider.autoDispose.family<PerformanceReport, double>((ref, balance) async {
  final resp = await ApiService.dio.get('brain/report/performance',
      queryParameters: {'balance': balance});
  return PerformanceReport.fromJson(resp.data as Map<String, dynamic>);
});

// ── Follow This Trade ─────────────────────────────────────────────────────────

class UserFollow {
  final String  id;
  final String  asset;
  final String  displayName;
  final String  action;
  final String  outcome;
  final int     confidence;
  final String  timeframe;
  final double? entryPrice;
  final double? exitPrice;
  final double? profitPct;
  final DateTime createdAt;

  const UserFollow({
    required this.id, required this.asset, required this.displayName,
    required this.action, required this.outcome, required this.confidence,
    required this.timeframe, required this.createdAt,
    this.entryPrice, this.exitPrice, this.profitPct,
  });

  factory UserFollow.fromJson(Map<String, dynamic> j) => UserFollow(
    id:          j['_id']?.toString()          ?? '',
    asset:       j['asset']?.toString()        ?? '',
    displayName: j['displayName']?.toString()  ?? j['asset']?.toString() ?? '',
    action:      j['action']?.toString()       ?? 'BUY',
    outcome:     j['outcome']?.toString()      ?? 'OPEN',
    confidence:  (j['confidence'] as num?)?.toInt() ?? 0,
    timeframe:   j['timeframe']?.toString()    ?? '4H',
    entryPrice:  (j['entryPrice'] as num?)?.toDouble(),
    exitPrice:   (j['exitPrice']  as num?)?.toDouble(),
    profitPct:   (j['profitPct']  as num?)?.toDouble(),
    createdAt:   DateTime.tryParse(j['createdAt']?.toString() ?? '') ?? DateTime.now(),
  );

  bool get isOpen => outcome == 'OPEN';
}

class FollowsState {
  final List<UserFollow> follows;
  final bool loading;
  const FollowsState({this.follows = const [], this.loading = false});
  FollowsState copyWith({List<UserFollow>? follows, bool? loading}) =>
      FollowsState(follows: follows ?? this.follows, loading: loading ?? this.loading);
}

class FollowsNotifier extends StateNotifier<FollowsState> {
  FollowsNotifier() : super(const FollowsState()) { fetch(); }

  Future<void> fetch() async {
    state = state.copyWith(loading: true);
    try {
      final resp = await ApiService.dio.get('brain/follows');
      final list = (resp.data['follows'] as List? ?? [])
          .map((j) => UserFollow.fromJson(j as Map<String, dynamic>))
          .toList();
      state = FollowsState(follows: list);
    } catch (_) {
      state = state.copyWith(loading: false);
    }
  }

  Future<bool> followTrade(Map<String, dynamic> data) async {
    try {
      final resp = await ApiService.dio.post('brain/follows', data: data);
      await fetch();
      return resp.data['alreadyFollowing'] != true;
    } catch (_) {
      return false;
    }
  }

  Future<void> closeTrade(String id,
      {required String outcome, double? exitPrice, double? profitPct}) async {
    try {
      await ApiService.dio.patch('brain/follows/$id/close', data: {
        'outcome':   outcome,
        if (exitPrice  != null) 'exitPrice':  exitPrice,
        if (profitPct  != null) 'profitPct':  profitPct,
      });
      await fetch();
    } catch (_) {}
  }

  Future<void> removeTrade(String id) async {
    state = state.copyWith(
        follows: state.follows.where((f) => f.id != id).toList());
    try {
      await ApiService.dio.delete('brain/follows/$id');
    } catch (_) {
      await fetch();
    }
  }

  bool isFollowing(String asset) =>
      state.follows.any((f) => f.asset == asset && f.isOpen);
}

final followsProvider =
    StateNotifierProvider<FollowsNotifier, FollowsState>((_) => FollowsNotifier());
