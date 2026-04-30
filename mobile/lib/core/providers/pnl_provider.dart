import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/pnl_model.dart';
import '../services/api_service.dart';

class PnLNotifier extends AsyncNotifier<PnLModel> {
  Timer? _timer;

  @override
  Future<PnLModel> build() async {
    ref.onDispose(() => _timer?.cancel());
    _timer = Timer.periodic(const Duration(seconds: 60), (_) {
      ref.invalidateSelf();
    });
    return _fetch();
  }

  Future<PnLModel> _fetch() async {
    final resp = await ApiService.dio.get('pnl/today');
    return PnLModel.fromJson(resp.data as Map<String, dynamic>);
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }
}

final pnlProvider = AsyncNotifierProvider<PnLNotifier, PnLModel>(PnLNotifier.new);
