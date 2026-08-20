import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/virtual_portfolio_model.dart';
import 'package:ai_trading_app/core/providers/virtual_portfolio_provider.dart';

VirtualTradeModel _trade(String id) => VirtualTradeModel(
      id: id,
      signalId: 'sig',
      asset: 'BTCUSDT',
      direction: 'BUY',
      entryPrice: 60000,
      sizeUsd: 100,
      status: 'open',
      openedAt: DateTime(2026, 8, 19),
    );

void main() {
  group('performanceRangeProvider', () {
    test('defaults to "all"', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(performanceRangeProvider), 'all');
    });

    test('can be updated to a specific range', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      container.read(performanceRangeProvider.notifier).state = '7d';
      expect(container.read(performanceRangeProvider), '7d');
    });
  });

  group('VirtualTradesState', () {
    test('defaults to an empty, non-loading, page-1, "all"-range state', () {
      const state = VirtualTradesState();
      expect(state.trades, isEmpty);
      expect(state.total, 0);
      expect(state.page, 1);
      expect(state.pages, 1);
      expect(state.loading, isFalse);
      expect(state.range, 'all');
    });

    test('copyWith overrides only the specified fields', () {
      final original = VirtualTradesState(trades: [_trade('t1')], total: 1, page: 1, pages: 1);
      final updated = original.copyWith(loading: true, page: 2);

      expect(updated.loading, isTrue);
      expect(updated.page, 2);
      // Untouched fields carry over.
      expect(updated.trades, original.trades);
      expect(updated.total, original.total);
      expect(updated.range, original.range);
    });

    test('copyWith with no arguments returns an equivalent state', () {
      final original = VirtualTradesState(trades: [_trade('t1')], range: '7d');
      final copy = original.copyWith();
      expect(copy.trades, original.trades);
      expect(copy.range, original.range);
      expect(copy.loading, original.loading);
    });
  });
}
