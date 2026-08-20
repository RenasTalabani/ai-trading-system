import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:ai_trading_app/core/models/signal_model.dart';
import 'package:ai_trading_app/features/dashboard/widgets/signal_card.dart';

SignalModel _signal({
  String id = 'sig1',
  String asset = 'BTCUSDT',
  String direction = 'BUY',
  double confidence = 82,
  double? stopLoss = 58000,
  double? takeProfit = 66000,
}) =>
    SignalModel(
      id: id,
      asset: asset,
      direction: direction,
      confidence: confidence,
      price: SignalPrice(entry: 60000, stopLoss: stopLoss, takeProfit: takeProfit),
      reason: 'test',
      sources: const SignalSources(marketScore: 70, newsScore: 40, socialScore: 10),
      status: 'active',
      createdAt: DateTime(2026, 8, 19, 12, 0),
    );

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('SignalCard rendering', () {
    testWidgets('shows the asset symbol, direction badge, and confidence percentage', (tester) async {
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal())));

      expect(find.text('BTCUSDT'), findsOneWidget);
      expect(find.text('BUY'), findsOneWidget);
      expect(find.text('82%'), findsOneWidget);
    });

    testWidgets('shows SELL direction text for a sell signal', (tester) async {
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal(direction: 'SELL'))));
      expect(find.text('SELL'), findsOneWidget);
    });

    testWidgets('non-compact mode shows the price row and sources row', (tester) async {
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal(), compact: false)));

      expect(find.text('Entry'), findsOneWidget);
      expect(find.text('Stop Loss'), findsOneWidget);
      expect(find.text('Take Profit'), findsOneWidget);
      expect(find.text('Market'), findsOneWidget);
      expect(find.text('News'), findsOneWidget);
      expect(find.text('Social'), findsOneWidget);
    });

    testWidgets('compact mode hides the price row and sources row', (tester) async {
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal(), compact: true)));

      expect(find.text('Entry'), findsNothing);
      expect(find.text('Market'), findsNothing);
      // The header/confidence bar still render in compact mode.
      expect(find.text('BTCUSDT'), findsOneWidget);
      expect(find.text('Confidence'), findsOneWidget);
    });

    testWidgets('omits the Stop Loss tile when the signal has no stop loss', (tester) async {
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal(stopLoss: null))));

      expect(find.text('Stop Loss'), findsNothing);
      expect(find.text('Take Profit'), findsOneWidget);
      // Entry is always shown regardless of stop/target presence.
      expect(find.text('Entry'), findsOneWidget);
    });

    testWidgets('omits the whole price row extras gracefully when neither stop nor target is set', (tester) async {
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal(stopLoss: null, takeProfit: null))));

      expect(find.text('Entry'), findsOneWidget);
      expect(find.text('Stop Loss'), findsNothing);
      expect(find.text('Take Profit'), findsNothing);
    });

    testWidgets('truncates the asset-icon label to at most 3 characters', (tester) async {
      // baseAsset for BTCUSDT is "BTC" (3 chars) -- appears both in the
      // icon placeholder and, formatted differently, nowhere else, so this
      // just confirms the icon renders without a RangeError from
      // substring() on a short/edge-length symbol.
      await tester.pumpWidget(_wrap(SignalCard(signal: _signal(asset: 'BTCUSDT'))));
      expect(tester.takeException(), isNull);
    });
  });

  group('SignalCard navigation', () {
    testWidgets('tapping the card navigates to /signals/:id', (tester) async {
      String? pushedLocation;
      final router = GoRouter(
        initialLocation: '/',
        routes: [
          GoRoute(
            path: '/',
            builder: (context, state) => Scaffold(body: SignalCard(signal: _signal(id: 'sig-42'))),
          ),
          GoRoute(
            path: '/signals/:id',
            builder: (context, state) {
              pushedLocation = state.uri.toString();
              return const Scaffold(body: Text('Signal detail'));
            },
          ),
        ],
      );

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.tap(find.byType(SignalCard));
      await tester.pumpAndSettle();

      expect(pushedLocation, '/signals/sig-42');
      expect(find.text('Signal detail'), findsOneWidget);
    });
  });
}
