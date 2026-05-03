import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

const kAdvisorAssets = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
];
const kAdvisorTimeframes = ['1h', '4h', '1d', '7d', '30d'];

// ── Form state ────────────────────────────────────────────────────────────────

class AdvisorFormState {
  final String asset;
  final List<String> timeframes;
  const AdvisorFormState({
    this.asset = 'BTCUSDT',
    this.timeframes = kAdvisorTimeframes,
  });
  AdvisorFormState copyWith({String? asset, List<String>? timeframes}) =>
      AdvisorFormState(asset: asset ?? this.asset, timeframes: timeframes ?? this.timeframes);
}

final advisorFormProvider = StateProvider<AdvisorFormState>((ref) => const AdvisorFormState());

// ── Per-timeframe recommendation ──────────────────────────────────────────────

class TimeframeRec {
  final String timeframe;
  final String label;
  final String action;
  final double confidence;
  final String expectedReturn;
  final double stopLoss;
  final double takeProfit;
  final String riskLevel;
  final String reason;
  final Map<String, dynamic> indicators;

  const TimeframeRec({
    required this.timeframe,
    required this.label,
    required this.action,
    required this.confidence,
    required this.expectedReturn,
    required this.stopLoss,
    required this.takeProfit,
    required this.riskLevel,
    required this.reason,
    required this.indicators,
  });

  factory TimeframeRec.fromJson(Map<String, dynamic> j) => TimeframeRec(
        timeframe:      j['timeframe']            as String? ?? '',
        label:          j['label']                as String? ?? '',
        action:         j['action']               as String? ?? 'HOLD',
        confidence:     (j['confidence'] as num?)?.toDouble() ?? 50,
        expectedReturn: j['expected_return_pct']  as String? ?? '0%',
        stopLoss:       (j['stop_loss']   as num?)?.toDouble() ?? 0,
        takeProfit:     (j['take_profit'] as num?)?.toDouble() ?? 0,
        riskLevel:      j['risk_level']           as String? ?? 'medium',
        reason:         j['reason']               as String? ?? '',
        indicators:     (j['indicators'] as Map?)?.cast<String, dynamic>() ?? {},
      );
}

// ── Result ────────────────────────────────────────────────────────────────────

class AdvisorResult {
  final String asset;
  final String overallAction;
  final double overallConfidence;
  final String trendAlignment;
  final int alignmentPct;
  final String bestTimeframe;
  final List<TimeframeRec> timeframes;

  const AdvisorResult({
    required this.asset,
    required this.overallAction,
    required this.overallConfidence,
    required this.trendAlignment,
    required this.alignmentPct,
    required this.bestTimeframe,
    required this.timeframes,
  });

  factory AdvisorResult.fromJson(Map<String, dynamic> j) => AdvisorResult(
        asset:              j['asset']              as String? ?? '',
        overallAction:      j['overall_action']     as String? ?? 'HOLD',
        overallConfidence:  (j['overall_confidence'] as num?)?.toDouble() ?? 50,
        trendAlignment:     j['trend_alignment']    as String? ?? 'neutral',
        alignmentPct:       (j['alignment_pct'] as num?)?.toInt() ?? 50,
        bestTimeframe:      j['best_timeframe']     as String? ?? '1d',
        timeframes: ((j['timeframes'] as List?) ?? [])
            .map((e) => TimeframeRec.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

// ── Provider state ────────────────────────────────────────────────────────────

class AdvisorState {
  final bool loading;
  final AdvisorResult? result;
  final String? error;
  const AdvisorState({this.loading = false, this.result, this.error});
  AdvisorState copyWith({bool? loading, AdvisorResult? result, String? error}) =>
      AdvisorState(loading: loading ?? this.loading, result: result ?? this.result, error: error);
}

class AdvisorNotifier extends StateNotifier<AdvisorState> {
  AdvisorNotifier() : super(const AdvisorState());

  Future<void> analyze(String asset, List<String> timeframes) async {
    state = const AdvisorState(loading: true);
    try {
      final resp = await ApiService.dio.post(
        'advisor/analyze',
        data: {'asset': asset, 'timeframes': timeframes},
        options: ApiService.slowOptions,
      );
      state = AdvisorState(result: AdvisorResult.fromJson(resp.data as Map<String, dynamic>));
    } catch (e) {
      state = AdvisorState(error: e.toString());
    }
  }
}

final advisorProvider = StateNotifierProvider<AdvisorNotifier, AdvisorState>(
  (ref) => AdvisorNotifier(),
);
