import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/signal_model.dart';
import 'package:ai_trading_app/core/providers/signals_provider.dart';

SignalModel _signal(String asset, String status, {String direction = 'BUY'}) => SignalModel(
      id: '$asset-$status',
      asset: asset,
      direction: direction,
      confidence: 80,
      price: const SignalPrice(entry: 100),
      reason: 'test',
      sources: const SignalSources(),
      status: status,
      createdAt: DateTime(2026, 8, 19),
    );

/// A SignalsNotifier double that holds fixed state instead of the real
/// notifier's fetch() behavior. SignalsNotifier's own constructor calls
/// fetch() unconditionally (super() runs before this subclass's body), so
/// fetch() is overridden to a no-op here first -- Dart's virtual dispatch
/// means the base constructor's call to `fetch()` routes to this override,
/// which is what prevents a real network request during the test.
/// overrideWith requires this exact concrete SignalsNotifier type, not just
/// any StateNotifier<SignalsState>.
class _FixedSignalsNotifier extends SignalsNotifier {
  _FixedSignalsNotifier(SignalsState fixedState) {
    state = fixedState;
  }

  @override
  Future<void> fetch() async {}
}

void main() {
  group('SignalsState.copyWith', () {
    test('overrides only the specified fields, keeping the rest', () {
      final original = SignalsState(signals: [_signal('BTCUSDT', 'active')], loading: true);
      final updated = original.copyWith(loading: false);
      expect(updated.loading, isFalse);
      expect(updated.signals, original.signals);
      expect(updated.refreshing, original.refreshing);
    });

    test('always resets error to null unless explicitly re-passed (documented, not a bug)', () {
      // Unlike the other fields (which use `field ?? this.field`), `error`
      // uses a plain `error: error` assignment -- so any copyWith call that
      // doesn't explicitly pass `error:` silently clears a prior error.
      // Confirmed intentional for this provider's actual two call sites
      // (fetch() clears the old error before a retry, and again on
      // success) -- documented here so a future edit doesn't "fix" this
      // into `error ?? this.error` without realizing it'd change behavior.
      final withError = const SignalsState(error: 'Network unreachable');
      final after = withError.copyWith(loading: true);
      expect(after.error, isNull);
    });

    test('error can still be explicitly carried forward if a caller chooses to', () {
      final withError = const SignalsState(error: 'Network unreachable');
      final after = withError.copyWith(loading: true, error: withError.error);
      expect(after.error, 'Network unreachable');
    });
  });

  group('assetSignalProvider', () {
    test('returns the active signal for the requested asset', () {
      final container = ProviderContainer(overrides: [
        signalsProvider.overrideWith((ref) => _FixedSignalsNotifier(SignalsState(signals: [
              _signal('BTCUSDT', 'active'),
              _signal('ETHUSDT', 'active'),
            ]))),
      ]);
      addTearDown(container.dispose);

      final result = container.read(assetSignalProvider('BTCUSDT'));
      expect(result?.asset, 'BTCUSDT');
    });

    test('returns null when the asset has no active signal', () {
      final container = ProviderContainer(overrides: [
        signalsProvider.overrideWith((ref) => _FixedSignalsNotifier(SignalsState(signals: [
              _signal('BTCUSDT', 'active'),
            ]))),
      ]);
      addTearDown(container.dispose);

      final result = container.read(assetSignalProvider('SOLUSDT'));
      expect(result, isNull);
    });

    test('ignores a signal for the asset that is not active (e.g. expired)', () {
      final container = ProviderContainer(overrides: [
        signalsProvider.overrideWith((ref) => _FixedSignalsNotifier(SignalsState(signals: [
              _signal('BTCUSDT', 'expired'),
            ]))),
      ]);
      addTearDown(container.dispose);

      final result = container.read(assetSignalProvider('BTCUSDT'));
      expect(result, isNull);
    });

    test('returns the first matching active signal when multiple exist for the same asset', () {
      final first = _signal('BTCUSDT', 'active', direction: 'BUY');
      final second = _signal('BTCUSDT', 'active', direction: 'SELL');
      final container = ProviderContainer(overrides: [
        signalsProvider.overrideWith((ref) => _FixedSignalsNotifier(SignalsState(signals: [first, second]))),
      ]);
      addTearDown(container.dispose);

      final result = container.read(assetSignalProvider('BTCUSDT'));
      expect(result?.direction, 'BUY');
    });
  });
}
