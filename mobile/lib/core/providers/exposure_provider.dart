import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/exposure_model.dart';
import '../services/api_service.dart';

class ExposureNotifier extends AsyncNotifier<ExposureSummary> {
  @override
  Future<ExposureSummary> build() => _fetch();

  Future<ExposureSummary> _fetch() async {
    final resp = await ApiService.dio.get('virtual/exposure');
    return ExposureSummary.fromJson(resp.data['data'] as Map<String, dynamic>);
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_fetch);
  }
}

final exposureProvider = AsyncNotifierProvider<ExposureNotifier, ExposureSummary>(
  ExposureNotifier.new,
);
