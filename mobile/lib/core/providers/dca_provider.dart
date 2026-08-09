import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/dca_model.dart';
import '../services/api_service.dart';

class DCANotifier extends AsyncNotifier<List<DCAPlanModel>> {
  @override
  Future<List<DCAPlanModel>> build() => _fetch();

  Future<List<DCAPlanModel>> _fetch() async {
    final resp = await ApiService.dio.get('virtual/dca');
    return (resp.data['plans'] as List)
        .map((e) => DCAPlanModel.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_fetch);
  }

  Future<void> startPlan({
    required String asset,
    required double amountPerBuy,
    required int frequencyDays,
  }) async {
    await ApiService.dio.post('virtual/dca/start', data: {
      'asset': asset,
      'amountPerBuy': amountPerBuy,
      'frequencyDays': frequencyDays,
    });
    await refresh();
  }

  Future<void> stopPlan(String planId) async {
    await ApiService.dio.post('virtual/dca/$planId/stop');
    await refresh();
  }
}

final dcaProvider = AsyncNotifierProvider<DCANotifier, List<DCAPlanModel>>(
  DCANotifier.new,
);
