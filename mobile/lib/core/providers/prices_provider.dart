import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/websocket_service.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

typedef PriceMap = Map<String, double>;

class PricesNotifier extends StateNotifier<PriceMap> {
  PricesNotifier() : super({}) {
    _init();
  }

  Future<void> _init() async {
    await _fetchRest();
    _listenWs();
  }

  Future<void> _fetchRest() async {
    try {
      final resp = await ApiService.dio.get(ApiConstants.livePrices);
      final data = resp.data['prices'] as Map<String, dynamic>? ?? {};
      state = data.map((k, v) {
        // API returns either a plain num or {price: num, ts: num}
        final raw = v is Map ? v['price'] : v;
        return MapEntry(k, (raw as num).toDouble());
      });
    } on DioException catch (_) {}
  }

  void _listenWs() {
    final ws = WebSocketService.instance;
    ws.stream.listen((msg) {
      if (msg.type == 'price_update' || msg.type == 'priceUpdate') {
        final asset = msg.data['asset'] as String?;
        final price = (msg.data['price'] as num?)?.toDouble();
        if (asset != null && price != null) {
          state = {...state, asset: price};
        }
      }
    });
  }

  double? priceOf(String asset) => state[asset];
}

final pricesProvider = StateNotifierProvider<PricesNotifier, PriceMap>(
  (_) => PricesNotifier(),
);

final assetPriceProvider = Provider.family<double?, String>((ref, asset) {
  return ref.watch(pricesProvider)[asset];
});
