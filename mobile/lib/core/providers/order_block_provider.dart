import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/order_block_model.dart';
import '../services/api_service.dart';

class OBFormState {
  final String asset;
  final String timeframe;
  const OBFormState({this.asset = 'BTCUSDT', this.timeframe = '1h'});
  OBFormState copyWith({String? asset, String? timeframe}) =>
      OBFormState(asset: asset ?? this.asset, timeframe: timeframe ?? this.timeframe);
}

final obFormProvider = StateProvider<OBFormState>((ref) => const OBFormState());

class OrderBlockNotifier extends AsyncNotifier<OrderBlockResult?> {
  @override
  Future<OrderBlockResult?> build() async => null;

  Future<void> analyze() async {
    final form = ref.read(obFormProvider);
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final resp = await ApiService.dio.get(
        'order-blocks/analyze',
        queryParameters: {'asset': form.asset, 'timeframe': form.timeframe},
        options: ApiService.slowOptions,
      );
      final data = resp.data as Map<String, dynamic>;
      if (data['success'] == false) throw Exception(data['message'] ?? 'Analysis failed');
      return OrderBlockResult.fromJson(data);
    });
  }
}

final orderBlockProvider =
    AsyncNotifierProvider<OrderBlockNotifier, OrderBlockResult?>(OrderBlockNotifier.new);
