import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

class GuideSuggestion {
  final String asset;
  final String displayName;
  final String action; // BUY or SELL -- unchanged, still drives approve()
  // T-066: derived WAIT/AVOID label from the AI pipeline (matches the
  // /predict pipeline's decision label, T-065). Purely additive -- falls
  // back to [action] below if the backend response omits it (older
  // backend build), so this is never null in practice.
  final String decision;
  final double amountUsd;
  final List<String> why;
  final String riskLevel; // Low / Medium / High
  final String confidenceWords;
  final double? maxLossUsd; // null = no stop-loss set, downside undefined
  final double? maxGainUsd; // null = no take-profit set, upside undefined

  const GuideSuggestion({
    required this.asset,
    required this.displayName,
    required this.action,
    required this.decision,
    required this.amountUsd,
    required this.why,
    required this.riskLevel,
    required this.confidenceWords,
    required this.maxLossUsd,
    required this.maxGainUsd,
  });

  factory GuideSuggestion.fromJson(Map<String, dynamic> json) => GuideSuggestion(
    asset:           json['asset'] as String,
    displayName:     json['displayName'] as String? ?? json['asset'] as String,
    action:          json['action'] as String,
    decision:        json['decision'] as String? ?? json['action'] as String,
    amountUsd:       (json['amountUsd'] as num).toDouble(),
    why:             (json['why'] as List).map((e) => e.toString()).toList(),
    riskLevel:       json['riskLevel'] as String,
    confidenceWords: json['confidenceWords'] as String,
    maxLossUsd:      (json['maxLossUsd'] as num?)?.toDouble(),
    maxGainUsd:      (json['maxGainUsd'] as num?)?.toDouble(),
  );
}

class GuideState {
  final bool loading;
  final bool approving;
  final GuideSuggestion? suggestion;
  final String? unavailableMessage;
  final String? error;
  final String? lastResultMessage; // shown briefly after approve/skip

  const GuideState({
    this.loading = false,
    this.approving = false,
    this.suggestion,
    this.unavailableMessage,
    this.error,
    this.lastResultMessage,
  });

  GuideState copyWith({
    bool? loading,
    bool? approving,
    GuideSuggestion? suggestion,
    String? unavailableMessage,
    String? error,
    String? lastResultMessage,
    bool clearSuggestion = false,
  }) => GuideState(
    loading:   loading   ?? this.loading,
    approving: approving ?? this.approving,
    suggestion: clearSuggestion ? null : (suggestion ?? this.suggestion),
    unavailableMessage: clearSuggestion ? unavailableMessage : (unavailableMessage ?? this.unavailableMessage),
    error: error,
    lastResultMessage: lastResultMessage,
  );
}

class GuideNotifier extends StateNotifier<GuideState> {
  Timer? _autoRefreshTimer;

  GuideNotifier() : super(const GuideState()) {
    fetch();
    // Re-check every minute so the suggestion stays current without the
    // user having to remember to pull-to-refresh.
    _autoRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (!state.approving) fetch(silent: true);
    });
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }

  // silent: true for background auto-refresh -- updates the suggestion
  // without flashing the loading spinner over whatever's currently on
  // screen, and swallows network errors instead of surfacing them (a
  // once-a-minute background check failing shouldn't disrupt the user).
  Future<void> fetch({bool silent = false}) async {
    if (!silent) {
      state = state.copyWith(loading: true, error: null, lastResultMessage: null);
    }
    try {
      final res = await ApiService.dio.get(ApiConstants.guideSuggestion);
      final data = res.data as Map<String, dynamic>;
      if (data['available'] == true) {
        state = state.copyWith(
          loading: false,
          suggestion: GuideSuggestion.fromJson(data),
          clearSuggestion: false,
        );
      } else {
        state = GuideState(
          loading: false,
          unavailableMessage: data['message'] as String? ?? "No suggestion right now.",
        );
      }
    } on DioException catch (_) {
      if (!silent) {
        state = state.copyWith(loading: false, error: "Couldn't reach the AI — check your connection and try again.");
      }
    }
  }

  Future<void> approve() async {
    if (state.suggestion == null || state.approving) return;
    state = state.copyWith(approving: true, error: null);
    try {
      final res = await ApiService.dio.post(ApiConstants.guideApprove);
      final message = (res.data as Map<String, dynamic>)['message'] as String? ?? 'Done.';
      // Show the confirmation on its own for a beat before moving on -- calling
      // fetch() immediately wiped this instantly, which is what made a working
      // "Yes, do it" tap look like it did nothing (confirmed: the trade WAS
      // created every time, the screen just never showed it).
      state = GuideState(loading: false, lastResultMessage: message);
      await Future.delayed(const Duration(seconds: 2));
      await fetch(); // load the next suggestion
    } on DioException catch (e) {
      final msg = (e.response?.data as Map?)?['message'] as String? ?? "Couldn't complete that — try again.";
      state = state.copyWith(approving: false, error: msg);
    }
  }

  void skip() {
    // No server-side dismissal yet — just clear locally so the screen feels
    // responsive; the next pull-to-refresh will show whatever is currently best.
    state = const GuideState(loading: false, unavailableMessage: "Skipped. Pull down to see what else the AI has in mind.");
  }
}

final guideProvider = StateNotifierProvider<GuideNotifier, GuideState>((ref) => GuideNotifier());
