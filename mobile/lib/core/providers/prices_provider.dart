import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/websocket_service.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

typedef PriceMap = Map<String, double>;

// Bug fix (2026-09-01, reported from a real device: "numbers are stuck and
// not autorefreshing, sometimes works and sometimes is stuck"). Root cause:
// this notifier used to fetch REST prices exactly ONCE at startup and then
// relied entirely on the WebSocket stream for every update after that --
// with no periodic fallback and no reconnect-on-resume hook anywhere in the
// app (confirmed: main.dart called WebSocketService.instance.connect() once
// and never again). A WebSocket that silently dies -- which happens
// routinely on mobile when the OS suspends the app in the background, or on
// a flaky connection -- left prices frozen at their last value with nothing
// to notice or correct it. Two independent fixes, so either one recovers
// the other's blind spot:
//   1. A periodic REST poll (below) that runs regardless of WS health --
//      a hard ceiling on how stale prices can ever get.
//   2. main.dart now reconnects the WS and calls refresh() the moment the
//      app resumes from background (see AppLifecycleState.resumed there).
const _pollInterval = Duration(seconds: 30);

class PricesNotifier extends StateNotifier<PriceMap> {
  Timer? _pollTimer;

  PricesNotifier() : super({}) {
    _init();
  }

  Future<void> _init() async {
    await _fetchRest();
    _listenWs();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _fetchRest());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
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
    } on DioException catch (_) {
      // Leave the last-known prices on screen rather than clearing them --
      // a transient network blip shouldn't blank out numbers the user was
      // just looking at. The next periodic poll (or a WS message) will
      // correct it.
    }
  }

  // Called from main.dart's app-lifecycle hook on resume, and available for
  // any screen's own pull-to-refresh to call directly instead of waiting
  // for the next periodic tick.
  Future<void> refresh() => _fetchRest();

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
