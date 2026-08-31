// MOBILE-001 (2026-08-31): Trade History's All/Open/Closed tabs all share
// VirtualTradesNotifier's single state with no request-ordering guard.
// Switching tabs quickly fires overlapping fetch() calls; without a
// sequence check, an older, slower response landing after a newer one
// silently overwrites it -- the wrong tab shows the wrong trades.
//
// This test proves the fix directly, against the real notifier and its
// real fetch() logic -- not a reimplementation of the sequencing rule in
// isolation. There's no HTTP-mocking package in this project yet, so this
// swaps a minimal fake dio.httpClientAdapter for the duration of the test
// (a standard, dependency-free Dio testing technique) and restores the
// real one afterward.
import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/providers/virtual_portfolio_provider.dart';
import 'package:ai_trading_app/core/services/api_service.dart';

/// Fake adapter: replies with the trades list registered for the request's
/// `status` query param, after an artificial delay controlled per-status --
/// lets the test make an EARLIER request resolve AFTER a LATER one, the
/// exact race the fix guards against.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.delays, this.tradesByStatus);

  final Map<String, Duration> delays;
  final Map<String, List<Map<String, dynamic>>> tradesByStatus;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final status = options.queryParameters['status'] as String? ?? 'all';
    await Future<void>.delayed(delays[status] ?? Duration.zero);
    final body = jsonEncode({
      'trades': tradesByStatus[status] ?? <Map<String, dynamic>>[],
      'total': (tradesByStatus[status] ?? const []).length,
      'page': 1,
      'pages': 1,
    });
    return ResponseBody.fromString(
      body, 200,
      headers: {'content-type': [Headers.jsonContentType]},
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> _tradeJson(String id, String status) => {
  '_id': id, 'signalId': 'sig', 'asset': 'BTCUSDT', 'direction': 'BUY',
  'entryPrice': 60000, 'sizeUsd': 100, 'status': status,
  'openedAt': '2026-08-19T00:00:00.000Z',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // ApiService.dio's _AuthInterceptor calls StorageService.getToken()
  // (flutter_secure_storage) on every request, before it ever reaches the
  // fake adapter below -- that plugin's platform channel has no real
  // implementation in a plain unit test and would otherwise throw,
  // masking the actual behavior under test behind a swallowed
  // MissingPluginException. Mocked here to just return "no stored token"
  // (null), a realistic, legitimate case -- not a workaround of anything
  // the fix itself depends on.
  const secureStorageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  late HttpClientAdapter originalAdapter;

  setUp(() {
    originalAdapter = ApiService.dio.httpClientAdapter;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (call) async {
      if (call.method == 'read') return null;
      return null;
    });
  });

  tearDown(() {
    ApiService.dio.httpClientAdapter = originalAdapter;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  test(
    'a slow OPEN-tab response landing after a fast CLOSED-tab response does not overwrite it (MOBILE-001)',
    () async {
      ApiService.dio.httpClientAdapter = _FakeAdapter(
        // 'open' is the OLDER request but resolves LAST -- exactly the race
        // that used to let a stale response win.
        {'open': const Duration(milliseconds: 60), 'closed': Duration.zero},
        {
          'open':   [_tradeJson('open-1', 'open')],
          'closed': [_tradeJson('closed-1', 'closed'), _tradeJson('closed-2', 'closed')],
        },
      );

      final container = ProviderContainer();
      addTearDown(container.dispose);

      // Riverpod providers build lazily on first read -- reading the
      // notifier is what actually triggers build()'s own
      // Future.microtask(fetch) in the first place. Read it, THEN wait for
      // that initial fetch to settle, so it can't still be in flight (and
      // racing for a higher _requestSeq than the two calls below) once the
      // real race starts.
      final notifier = container.read(virtualTradesProvider.notifier);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // User taps "Open" then quickly taps "Closed" -- both fetches are in
      // flight at once, "open" (started first) resolving later.
      final openFuture   = notifier.fetch(status: 'open');
      final closedFuture = notifier.fetch(status: 'closed');
      await Future.wait([openFuture, closedFuture]);

      final state = container.read(virtualTradesProvider);

      // The user's LAST action was tapping "Closed" -- that must be what's
      // showing, regardless of which network response actually landed last.
      expect(state.trades.map((t) => t.id), ['closed-1', 'closed-2']);
      expect(state.loading, isFalse);
    },
  );

  test(
    'the reverse ordering (fast request first, slow one truly is the latest) still applies the slow one normally',
    () async {
      ApiService.dio.httpClientAdapter = _FakeAdapter(
        {'open': Duration.zero, 'closed': const Duration(milliseconds: 40)},
        {
          'open':   [_tradeJson('open-1', 'open')],
          'closed': [_tradeJson('closed-1', 'closed')],
        },
      );

      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(virtualTradesProvider.notifier);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      await notifier.fetch(status: 'open');
      await notifier.fetch(status: 'closed');

      final state = container.read(virtualTradesProvider);
      expect(state.trades.map((t) => t.id), ['closed-1']);
    },
  );
}
