import 'dart:async';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/providers/sparkline_provider.dart';
import 'package:ai_trading_app/core/widgets/sparkline_chart.dart';

Widget _wrap(Widget child, {required List<Override> overrides}) => ProviderScope(
      overrides: overrides,
      child: MaterialApp(home: Scaffold(body: child)),
    );

void main() {
  group('SparklineChart', () {
    testWidgets('renders a LineChart when there are enough varying points', (tester) async {
      await tester.pumpWidget(_wrap(
        const SparklineChart(asset: 'BTCUSDT'),
        overrides: [
          sparklineProvider('BTCUSDT').overrideWith((ref) async => [100, 102, 98, 105, 103]),
        ],
      ));
      await tester.pump();

      expect(find.byType(LineChart), findsOneWidget);
    });

    testWidgets('renders nothing (no crash) while the data is still loading', (tester) async {
      await tester.pumpWidget(_wrap(
        const SparklineChart(asset: 'BTCUSDT'),
        overrides: [
          sparklineProvider('BTCUSDT').overrideWith((ref) => Completer<List<double>>().future),
        ],
      ));
      // Deliberately not pumping past the first frame -- provider stays loading.
      expect(find.byType(LineChart), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders nothing when the provider errors out', (tester) async {
      await tester.pumpWidget(_wrap(
        const SparklineChart(asset: 'BTCUSDT'),
        overrides: [
          sparklineProvider('BTCUSDT').overrideWith((ref) async => throw Exception('boom')),
        ],
      ));
      await tester.pump();

      expect(find.byType(LineChart), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders nothing when there are fewer than 2 points', (tester) async {
      await tester.pumpWidget(_wrap(
        const SparklineChart(asset: 'BTCUSDT'),
        overrides: [
          sparklineProvider('BTCUSDT').overrideWith((ref) async => [100]),
        ],
      ));
      await tester.pump();

      expect(find.byType(LineChart), findsNothing);
    });

    testWidgets('renders nothing when every point is identical (zero range, avoids a degenerate chart)', (tester) async {
      await tester.pumpWidget(_wrap(
        const SparklineChart(asset: 'BTCUSDT'),
        overrides: [
          sparklineProvider('BTCUSDT').overrideWith((ref) async => [100, 100, 100]),
        ],
      ));
      await tester.pump();

      expect(find.byType(LineChart), findsNothing);
    });

    testWidgets('respects the custom width/height when provided', (tester) async {
      await tester.pumpWidget(_wrap(
        const SparklineChart(asset: 'BTCUSDT', width: 120, height: 48),
        overrides: [
          sparklineProvider('BTCUSDT').overrideWith((ref) async => [100, 110]),
        ],
      ));
      await tester.pump();

      final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox).first);
      expect(sizedBox.width, 120);
      expect(sizedBox.height, 48);
    });
  });
}
