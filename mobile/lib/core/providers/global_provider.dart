import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';

// ── Asset class badge colours are in the UI layer, not here ──────────────────

const kDefaultTimeframe = '1h';
const kDefaultTopN      = 5;

// ── Models ────────────────────────────────────────────────────────────────────

class GlobalOpportunity {
  final String  asset;
  final String  displayName;
  final String  assetClass;      // crypto | commodity | forex
  final String  action;          // BUY | SELL | HOLD
  final int     confidence;
  final double  fusedScore;
  final double? currentPrice;
  final double? rsi;
  final String? trend;
  final double  newsScore;
  final String? entryZone;
  final double? stopLoss;
  final double? takeProfit;
  final String? riskReward;
  final String? reason;
  final int     rank;

  const GlobalOpportunity({
    required this.asset,
    required this.displayName,
    required this.assetClass,
    required this.action,
    required this.confidence,
    required this.fusedScore,
    required this.newsScore,
    required this.rank,
    this.currentPrice,
    this.rsi,
    this.trend,
    this.entryZone,
    this.stopLoss,
    this.takeProfit,
    this.riskReward,
    this.reason,
  });

  factory GlobalOpportunity.fromJson(Map<String, dynamic> j) =>
      GlobalOpportunity(
        asset:        j['asset']        as String? ?? '',
        displayName:  j['display_name'] as String? ?? j['asset'] as String? ?? '',
        assetClass:   j['asset_class']  as String? ?? 'crypto',
        action:       j['action']       as String? ?? 'HOLD',
        confidence:   (j['confidence']  as num?)?.toInt()    ?? 50,
        fusedScore:   (j['fused_score'] as num?)?.toDouble() ?? 50.0,
        newsScore:    (j['news_score']  as num?)?.toDouble() ?? 50.0,
        rank:         (j['rank']        as num?)?.toInt()    ?? 0,
        currentPrice: (j['current_price'] as num?)?.toDouble(),
        rsi:          (j['rsi']           as num?)?.toDouble(),
        trend:        j['trend']         as String?,
        entryZone:    j['entry_zone']    as String?,
        stopLoss:     (j['stop_loss']    as num?)?.toDouble(),
        takeProfit:   (j['take_profit']  as num?)?.toDouble(),
        riskReward:   j['risk_reward']   as String?,
        reason:       j['reason']        as String?,
      );
}

class GlobalScanResult {
  final bool                    success;
  final int                     scanned;
  final double                  capital;
  final String                  timeframe;
  final GlobalOpportunity?      best;
  final List<GlobalOpportunity> topOpportunities;

  const GlobalScanResult({
    required this.success,
    required this.scanned,
    required this.capital,
    required this.timeframe,
    required this.topOpportunities,
    this.best,
  });

  factory GlobalScanResult.fromJson(Map<String, dynamic> j) {
    final rawTop = (j['top_opportunities'] as List?) ?? [];
    return GlobalScanResult(
      success:          j['success']   as bool?   ?? false,
      scanned:          (j['scanned']  as num?)?.toInt()    ?? 0,
      capital:          (j['capital']  as num?)?.toDouble() ?? 500.0,
      timeframe:        j['timeframe'] as String? ?? '1h',
      best:             j['best'] != null
          ? GlobalOpportunity.fromJson(j['best'] as Map<String, dynamic>)
          : null,
      topOpportunities: rawTop
          .map((e) => GlobalOpportunity.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class GlobalScanNotifier extends AsyncNotifier<GlobalScanResult?> {
  @override
  Future<GlobalScanResult?> build() async {
    // Load cached result on first build — fast (no AI wait)
    await loadLatest();
    return state.value;
  }

  /// Loads the server-cached result instantly (updated every 30 min by the cron job).
  Future<void> loadLatest() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final resp = await ApiService.dio.get('global/latest');
      final data = resp.data as Map<String, dynamic>;
      if (data['success'] == false) {
        throw Exception(data['message'] ?? 'No global scan data yet');
      }
      return GlobalScanResult.fromJson(data);
    });
  }

  /// Forces a full fresh scan (takes ~60 s). Use on manual refresh only.
  Future<void> scan({String timeframe = kDefaultTimeframe}) async {
    state = const AsyncLoading();
    final budget = await StorageService.getBudget();
    state = await AsyncValue.guard(() async {
      final resp = await ApiService.dio.post(
        'global/scan',
        data: {
          'capital':   budget,
          'timeframe': timeframe,
          'top_n':     kDefaultTopN,
        },
        options: ApiService.slowOptions,
      );
      final data = resp.data as Map<String, dynamic>;
      if (data['success'] == false) {
        throw Exception(data['message'] ?? 'Global scan failed');
      }
      return GlobalScanResult.fromJson(data);
    });
  }
}

final globalScanProvider =
    AsyncNotifierProvider<GlobalScanNotifier, GlobalScanResult?>(
        GlobalScanNotifier.new);
