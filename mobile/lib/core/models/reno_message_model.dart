// RENO Phase 3, steps 4-5 (2026-09-01) — data models for the mobile RENO
// chat screen.
//
// PREPARED, NOT VERIFIED: written and reviewed by hand against the real
// backend response shapes (conversationService.js's sendMessage/getThread/
// approvePlan, ConversationMessage.js's schema, resolveSuggestion()'s and
// buildPositionGuidance()'s real return shapes — all read directly from the
// backend source before writing this file). No Flutter/Dart toolchain was
// available in the environment that wrote this (`flutter`/`dart` not found,
// and no network path to install them — confirmed by direct attempt), so
// this has NOT been run through `flutter analyze`, `flutter test`, or a
// real build. Treat as a solid first draft for a session/person with real
// Flutter tooling to compile, test, and adjust — not as verified-working code.
//
// Design rule carried over from GuideSuggestion (guide_provider.dart) and
// the whole engagement's core honesty rule: every field here is optional
// unless the backend genuinely always sends it, and every widget that reads
// these models must render "not available" rather than invent a value for
// a null field. Nothing here fabricates a number the backend didn't return.

class RenoToolCall {
  final String name;
  final Map<String, dynamic> args;
  final Map<String, dynamic>? result;

  const RenoToolCall({required this.name, required this.args, required this.result});

  factory RenoToolCall.fromJson(Map<String, dynamic> json) {
    final rawResult = json['result'];
    return RenoToolCall(
      name: json['name'] as String? ?? '',
      args: (json['args'] as Map<String, dynamic>?) ?? const {},
      result: rawResult is Map<String, dynamic> ? rawResult : null,
    );
  }
}

class RenoMessage {
  final String id;
  final String role; // 'user' | 'assistant' | 'system'
  final String content;
  final DateTime createdAt;
  final List<RenoToolCall> toolCalls;
  final List<String> relatedTradeIds;
  final String? proactiveTrigger; // set only on server-initiated proactive messages

  const RenoMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
    required this.toolCalls,
    required this.relatedTradeIds,
    this.proactiveTrigger,
  });

  factory RenoMessage.fromJson(Map<String, dynamic> json) {
    final rawToolCalls = json['toolCalls'] as List? ?? const [];
    final rawRelated = json['relatedTradeIds'] as List? ?? const [];
    DateTime created;
    try {
      created = DateTime.parse(json['createdAt'] as String? ?? '');
    } catch (_) {
      created = DateTime.now();
    }
    return RenoMessage(
      id: (json['_id'] ?? json['id'] ?? '').toString(),
      role: json['role'] as String? ?? 'assistant',
      content: json['content'] as String? ?? '',
      createdAt: created,
      toolCalls: rawToolCalls
          .whereType<Map<String, dynamic>>()
          .map((e) => RenoToolCall.fromJson(e))
          .toList(),
      relatedTradeIds: rawRelated.map((e) => e.toString()).toList(),
      proactiveTrigger: json['proactiveTrigger'] as String?,
    );
  }

  bool get isUser => role == 'user';

  // Only a `get_suggestion` tool call whose result actually carries a real
  // suggestion (has an `asset` field) counts -- the "no strong
  // recommendation right now" shape returns only a `message` field and
  // must never be rendered as an opportunity card.
  RenoOpportunity? get opportunity {
    for (final call in toolCalls) {
      if (call.name != 'get_suggestion') continue;
      final r = call.result;
      if (r == null || r['asset'] == null) continue;
      return RenoOpportunity.fromJson(r);
    }
    return null;
  }

  List<RenoPosition>? get openPositions {
    for (final call in toolCalls) {
      if (call.name != 'get_open_positions') continue;
      final r = call.result;
      final rawPositions = r?['positions'] as List?;
      if (rawPositions == null || rawPositions.isEmpty) continue;
      return rawPositions
          .whereType<Map<String, dynamic>>()
          .map((e) => RenoPosition.fromJson(e))
          .toList();
    }
    return null;
  }

  // Raw pass-through for get_portfolio_summary / get_track_record — these
  // are plain key/value stat objects already shaped correctly by the
  // backend (virtualTrackingService.getSummary / getTrackRecordByAsset),
  // so there's no separate typed model here: the stats widget renders
  // whatever keys are actually present and nothing it doesn't recognize.
  Map<String, dynamic>? get portfolioSummary {
    for (final call in toolCalls) {
      if (call.name == 'get_portfolio_summary' && call.result != null) return call.result;
    }
    return null;
  }

  Map<String, dynamic>? get trackRecord {
    for (final call in toolCalls) {
      if (call.name == 'get_track_record' && call.result != null) return call.result;
    }
    return null;
  }

  List<Map<String, dynamic>>? get recentOutcomes {
    for (final call in toolCalls) {
      if (call.name != 'get_recent_trade_outcomes') continue;
      final r = call.result;
      final rawTrades = r?['trades'] as List?;
      if (rawTrades == null || rawTrades.isEmpty) continue;
      return rawTrades.whereType<Map<String, dynamic>>().toList();
    }
    return null;
  }
}

// Raw shape of resolveSuggestion()'s return value, as returned verbatim by
// the get_suggestion tool executor (backend/src/services/conversationService.js
// _execGetSuggestion() -> guideController.resolveSuggestion()). Deliberately
// NOT the same shape as GuideSuggestion (guide_provider.dart) -- that one is
// guideController.getSuggestion()'s HTTP-only, Guide-screen-specific
// transformation (amountUsd/maxLossUsd/maxGainUsd/riskLevel/confidenceWords
// computed there). RENO's raw tool result has no sizing/risk-dollar fields
// at all -- honestly omitted here rather than invented.
class RenoOpportunity {
  final String asset;
  final String displayName;
  final String action; // BUY or SELL
  final String decision; // BUY/SELL/WAIT/AVOID label
  final double? entryPrice;
  final double? stopLoss;
  final double? takeProfit;
  final double? confidence; // 0..1 raw, not a words label
  final List<String> why;
  final String? timeframe;
  final String? generatedAt;
  final bool isOlderSignal;

  const RenoOpportunity({
    required this.asset,
    required this.displayName,
    required this.action,
    required this.decision,
    required this.entryPrice,
    required this.stopLoss,
    required this.takeProfit,
    required this.confidence,
    required this.why,
    required this.timeframe,
    required this.generatedAt,
    required this.isOlderSignal,
  });

  factory RenoOpportunity.fromJson(Map<String, dynamic> json) => RenoOpportunity(
        asset: json['asset'] as String,
        displayName: json['displayName'] as String? ?? json['asset'] as String,
        action: json['action'] as String? ?? '',
        decision: json['decision'] as String? ?? json['action'] as String? ?? '',
        entryPrice: (json['entryPrice'] as num?)?.toDouble(),
        stopLoss: (json['stopLoss'] as num?)?.toDouble(),
        takeProfit: (json['takeProfit'] as num?)?.toDouble(),
        confidence: (json['confidence'] as num?)?.toDouble(),
        why: (json['why'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        timeframe: json['timeframe'] as String?,
        generatedAt: json['generatedAt']?.toString(),
        isOlderSignal: json['isOlderSignal'] as bool? ?? false,
      );
}

// Raw shape of buildPositionGuidance()'s return value (backend/src/controllers/
// guideController.js), as returned verbatim by get_open_positions.
class RenoPosition {
  final String tradeId;
  final String asset;
  final String direction;
  final double sizeUsd;
  final double entryPrice;
  final double? currentPrice;
  final double? pnlPct;
  final String recommendation; // HOLD or SELL (Guide's own binary -- RENO's
                                // richer 4-state model isn't part of this
                                // tool's result; only the monitoring job
                                // computes it server-side today)
  final List<String> why;
  final String? holdEstimate;
  final bool isHalted;
  final double? maxLossUsd;
  final double? maxGainUsd;

  const RenoPosition({
    required this.tradeId,
    required this.asset,
    required this.direction,
    required this.sizeUsd,
    required this.entryPrice,
    required this.currentPrice,
    required this.pnlPct,
    required this.recommendation,
    required this.why,
    required this.holdEstimate,
    required this.isHalted,
    required this.maxLossUsd,
    required this.maxGainUsd,
  });

  factory RenoPosition.fromJson(Map<String, dynamic> json) => RenoPosition(
        tradeId: (json['tradeId'] ?? '').toString(),
        asset: json['asset'] as String? ?? '',
        direction: json['direction'] as String? ?? '',
        sizeUsd: (json['sizeUsd'] as num?)?.toDouble() ?? 0,
        entryPrice: (json['entryPrice'] as num?)?.toDouble() ?? 0,
        currentPrice: (json['currentPrice'] as num?)?.toDouble(),
        pnlPct: (json['pnlPct'] as num?)?.toDouble(),
        recommendation: json['recommendation'] as String? ?? 'HOLD',
        why: (json['why'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        holdEstimate: json['holdEstimate'] as String?,
        isHalted: json['isHalted'] as bool? ?? false,
        maxLossUsd: (json['maxLossUsd'] as num?)?.toDouble(),
        maxGainUsd: (json['maxGainUsd'] as num?)?.toDouble(),
      );
}
