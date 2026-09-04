import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/ai_decision_model.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

// Master-plan decision #21's secondary history panel. Simple
// fetch-once-plus-refresh read, same pattern as benchmarkProvider /
// virtualPerformanceProvider -- this screen has no mutation actions, only a
// pull-to-refresh, so an AsyncNotifier is enough (no StateNotifier needed).
class AIDecisionHistoryNotifier extends AsyncNotifier<List<AIDecisionModel>> {
  @override
  Future<List<AIDecisionModel>> build() => _fetch();

  Future<List<AIDecisionModel>> _fetch() async {
    final resp = await ApiService.dio.get(
      ApiConstants.aiBrainDecisionHistory,
      queryParameters: {'limit': 100},
    );
    final list = (resp.data['decisions'] as List? ?? [])
        .map((j) => AIDecisionModel.fromJson(j as Map<String, dynamic>))
        .toList();
    return list;
  }

  Future<void> fetch() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetch);
  }
}

final aiDecisionHistoryProvider =
    AsyncNotifierProvider<AIDecisionHistoryNotifier, List<AIDecisionModel>>(
  AIDecisionHistoryNotifier.new,
);
