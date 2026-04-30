import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';

const kAIAssets = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT',
];

const kAITimeframes = ['15m', '1h', '4h', '1d'];

// ── Form state ────────────────────────────────────────────────────────────────

class AIBrainFormState {
  final String asset;
  final String timeframe;
  final double budget;

  const AIBrainFormState({
    this.asset     = 'BTCUSDT',
    this.timeframe = '1h',
    this.budget    = 500.0,
  });

  AIBrainFormState copyWith({String? asset, String? timeframe, double? budget}) =>
      AIBrainFormState(
        asset:     asset     ?? this.asset,
        timeframe: timeframe ?? this.timeframe,
        budget:    budget    ?? this.budget,
      );
}

final aiBrainFormProvider =
    StateProvider<AIBrainFormState>((ref) => const AIBrainFormState());

Future<double> loadSavedBudget() => StorageService.getBudget();

// ── Sub-models ────────────────────────────────────────────────────────────────

class AIBrainSignal {
  final String  action;
  final int     confidence;
  final String? entryZone;
  final double? stopLoss;
  final double? takeProfit;
  final String? riskReward;
  final String? reason;

  const AIBrainSignal({
    required this.action,
    required this.confidence,
    this.entryZone,
    this.stopLoss,
    this.takeProfit,
    this.riskReward,
    this.reason,
  });

  factory AIBrainSignal.fromJson(Map<String, dynamic> j) => AIBrainSignal(
    action:     j['action']      as String? ?? 'HOLD',
    confidence: (j['confidence'] as num?)?.toInt() ?? 50,
    entryZone:  j['entry_zone']  as String?,
    stopLoss:   (j['stop_loss']  as num?)?.toDouble(),
    takeProfit: (j['take_profit'] as num?)?.toDouble(),
    riskReward: j['risk_reward'] as String?,
    reason:     j['reason']      as String?,
  );
}

class AIBrainTechnical {
  final String  obAction;
  final int     obConfidence;
  final String? obEntryZone;
  final double? obStopLoss;
  final double? obTakeProfit;
  final String? obRiskReward;
  final String? obReason;
  final String  strategyRec;
  final double  strategyConfidence;
  final String? strategyReasoning;
  final double  expectedMovePercent;
  final double? currentPrice;
  final double? ema50;
  final double? ema200;
  final double? rsi;
  final String? trend;

  const AIBrainTechnical({
    required this.obAction,
    required this.obConfidence,
    required this.strategyRec,
    required this.strategyConfidence,
    required this.expectedMovePercent,
    this.obEntryZone,
    this.obStopLoss,
    this.obTakeProfit,
    this.obRiskReward,
    this.obReason,
    this.strategyReasoning,
    this.currentPrice,
    this.ema50,
    this.ema200,
    this.rsi,
    this.trend,
  });

  factory AIBrainTechnical.fromJson(Map<String, dynamic> j) => AIBrainTechnical(
    obAction:            j['ob_action']            as String? ?? 'HOLD',
    obConfidence:        (j['ob_confidence']        as num?)?.toInt() ?? 50,
    obEntryZone:         j['ob_entry_zone']         as String?,
    obStopLoss:          (j['ob_stop_loss']         as num?)?.toDouble(),
    obTakeProfit:        (j['ob_take_profit']       as num?)?.toDouble(),
    obRiskReward:        j['ob_risk_reward']        as String?,
    obReason:            j['ob_reason']             as String?,
    strategyRec:         j['strategy_recommendation'] as String? ?? 'HOLD',
    strategyConfidence:  (j['strategy_confidence'] as num?)?.toDouble() ?? 50.0,
    strategyReasoning:   j['strategy_reasoning']   as String?,
    expectedMovePercent: (j['expected_move_percent'] as num?)?.toDouble() ?? 0.0,
    currentPrice:        (j['current_price']        as num?)?.toDouble(),
    ema50:               (j['ema50']                as num?)?.toDouble(),
    ema200:              (j['ema200']               as num?)?.toDouble(),
    rsi:                 (j['rsi']                  as num?)?.toDouble(),
    trend:               j['trend']                 as String?,
  );
}

class AIBrainSentiment {
  final double      newsScore;
  final double      socialScore;
  final double      combinedScore;
  final String      sentiment;
  final double      impact;
  final List<String> topEvents;
  final int         articleCount;

  const AIBrainSentiment({
    required this.newsScore,
    required this.socialScore,
    required this.combinedScore,
    required this.sentiment,
    required this.impact,
    required this.topEvents,
    required this.articleCount,
  });

  factory AIBrainSentiment.fromJson(Map<String, dynamic> j) => AIBrainSentiment(
    newsScore:    (j['news_score']    as num?)?.toDouble() ?? 50,
    socialScore:  (j['social_score']  as num?)?.toDouble() ?? 50,
    combinedScore:(j['combined_score'] as num?)?.toDouble() ?? 50,
    sentiment:    j['sentiment']      as String? ?? 'neutral',
    impact:       (j['impact']        as num?)?.toDouble() ?? 0.0,
    topEvents:    (j['top_events']    as List?)?.cast<String>() ?? const [],
    articleCount: (j['article_count'] as num?)?.toInt() ?? 0,
  );
}

class AIBrainAllocation {
  final double capital;
  final double recommended;
  final double riskAmount;
  final double expectedProfit;
  final double expectedLoss;
  final double winRate;

  const AIBrainAllocation({
    required this.capital,
    required this.recommended,
    required this.riskAmount,
    required this.expectedProfit,
    required this.expectedLoss,
    required this.winRate,
  });

  factory AIBrainAllocation.fromJson(Map<String, dynamic> j) => AIBrainAllocation(
    capital:        (j['capital']         as num?)?.toDouble() ?? 500,
    recommended:    (j['recommended']     as num?)?.toDouble() ?? 300,
    riskAmount:     (j['risk_amount']     as num?)?.toDouble() ?? 15,
    expectedProfit: (j['expected_profit'] as num?)?.toDouble() ?? 0,
    expectedLoss:   (j['expected_loss']   as num?)?.toDouble() ?? 0,
    winRate:        (j['win_rate']        as num?)?.toDouble() ?? 50,
  );
}

class AIBrainResult {
  final String           asset;
  final String           timeframe;
  final AIBrainSignal    signal;
  final AIBrainTechnical technical;
  final AIBrainSentiment sentiment;
  final AIBrainAllocation allocation;

  const AIBrainResult({
    required this.asset,
    required this.timeframe,
    required this.signal,
    required this.technical,
    required this.sentiment,
    required this.allocation,
  });

  factory AIBrainResult.fromJson(Map<String, dynamic> j) => AIBrainResult(
    asset:      j['asset']     as String? ?? '',
    timeframe:  j['timeframe'] as String? ?? '1h',
    signal:     AIBrainSignal.fromJson(j['signal']     as Map<String, dynamic>),
    technical:  AIBrainTechnical.fromJson(j['technical'] as Map<String, dynamic>),
    sentiment:  AIBrainSentiment.fromJson(j['sentiment'] as Map<String, dynamic>),
    allocation: AIBrainAllocation.fromJson(j['allocation'] as Map<String, dynamic>),
  );
}

// ── Notifier ──────────────────────────────────────────────────────────────────

class AIBrainNotifier extends AsyncNotifier<AIBrainResult?> {
  @override
  Future<AIBrainResult?> build() async => null;

  Future<void> analyze() async {
    final form = ref.read(aiBrainFormProvider);
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final resp = await ApiService.dio.post(
        'unified/analyze',
        data: {
          'asset':     form.asset,
          'timeframe': form.timeframe,
          'capital':   form.budget,
        },
        options: ApiService.slowOptions,
      );
      final data = resp.data as Map<String, dynamic>;
      if (data['success'] == false) {
        throw Exception(data['message'] ?? 'Analysis failed');
      }
      return AIBrainResult.fromJson(data);
    });
  }
}

final aiBrainProvider =
    AsyncNotifierProvider<AIBrainNotifier, AIBrainResult?>(AIBrainNotifier.new);
