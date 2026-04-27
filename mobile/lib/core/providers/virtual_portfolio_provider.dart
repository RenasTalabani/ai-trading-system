import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/virtual_portfolio_model.dart';
import '../services/api_service.dart';

// ─── Range selector ───────────────────────────────────────────────────────────

final performanceRangeProvider = StateProvider<String>((ref) => 'all');

// ─── Performance provider ─────────────────────────────────────────────────────

class VirtualPerformanceNotifier
    extends AsyncNotifier<VirtualPerformanceModel> {
  @override
  Future<VirtualPerformanceModel> build() {
    final range = ref.watch(performanceRangeProvider);
    return _fetch(range);
  }

  Future<VirtualPerformanceModel> _fetch(String range) async {
    final resp = await ApiService.dio.get(
      '/virtual/performance',
      queryParameters: {'range': range},
    );
    return VirtualPerformanceModel.fromJson(resp.data['data'] as Map<String, dynamic>);
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    final range = ref.read(performanceRangeProvider);
    state = await AsyncValue.guard(() => _fetch(range));
  }

  Future<void> reset({double balance = 500, double riskPct = 5}) async {
    await ApiService.dio.post('/virtual/reset', data: {
      'startingBalance': balance,
      'riskPerTradePct': riskPct,
    });
    await refresh();
  }

  Future<void> setCapital({double? balance, double? riskPct}) async {
    final body = <String, dynamic>{};
    if (balance != null) body['startingBalance'] = balance;
    if (riskPct != null) body['riskPerTradePct'] = riskPct;
    await ApiService.dio.post('/virtual/set-capital', data: body);
    await refresh();
  }
}

final virtualPerformanceProvider =
    AsyncNotifierProvider<VirtualPerformanceNotifier, VirtualPerformanceModel>(
  VirtualPerformanceNotifier.new,
);

// ─── Trades provider ──────────────────────────────────────────────────────────

class VirtualTradesState {
  final List<VirtualTradeModel> trades;
  final int total;
  final int page;
  final int pages;
  final bool loading;
  final String range;

  const VirtualTradesState({
    this.trades  = const [],
    this.total   = 0,
    this.page    = 1,
    this.pages   = 1,
    this.loading = false,
    this.range   = 'all',
  });

  VirtualTradesState copyWith({
    List<VirtualTradeModel>? trades,
    int? total, int? page, int? pages, bool? loading, String? range,
  }) => VirtualTradesState(
    trades:  trades  ?? this.trades,
    total:   total   ?? this.total,
    page:    page    ?? this.page,
    pages:   pages   ?? this.pages,
    loading: loading ?? this.loading,
    range:   range   ?? this.range,
  );
}

class VirtualTradesNotifier extends Notifier<VirtualTradesState> {
  @override
  VirtualTradesState build() {
    Future.microtask(fetch);
    return const VirtualTradesState(loading: true);
  }

  Future<void> fetch({int page = 1, String? status, String? range}) async {
    final effectiveRange = range ?? state.range;
    state = state.copyWith(loading: true, range: effectiveRange);
    try {
      final params = <String, dynamic>{'page': page, 'limit': 20};
      if (status != null) params['status'] = status;
      if (effectiveRange != 'all') params['range'] = effectiveRange;

      final resp = await ApiService.dio.get('/virtual/trades',
          queryParameters: params);

      final list = (resp.data['trades'] as List)
          .map((e) => VirtualTradeModel.fromJson(e as Map<String, dynamic>))
          .toList();

      state = state.copyWith(
        trades:  list,
        total:   resp.data['total']  as int,
        page:    resp.data['page']   as int,
        pages:   resp.data['pages']  as int,
        loading: false,
      );
    } catch (_) {
      state = state.copyWith(loading: false);
    }
  }
}

final virtualTradesProvider =
    NotifierProvider<VirtualTradesNotifier, VirtualTradesState>(
  VirtualTradesNotifier.new,
);
