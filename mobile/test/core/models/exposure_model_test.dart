import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/models/exposure_model.dart';

void main() {
  group('AssetExposure', () {
    test('fromJson takes the asset symbol from the map key, not the value', () {
      final exposure = AssetExposure.fromJson('BTCUSDT', {
        'notionalUsd': 500.0,
        'count': 2,
        'concentrationPct': 40.0,
      });
      expect(exposure.asset, 'BTCUSDT');
      expect(exposure.notionalUsd, 500.0);
      expect(exposure.count, 2);
      expect(exposure.concentrationPct, 40.0);
    });

    test('fromJson defaults missing numeric fields to 0', () {
      final exposure = AssetExposure.fromJson('ETHUSDT', {});
      expect(exposure.notionalUsd, 0);
      expect(exposure.count, 0);
      expect(exposure.concentrationPct, 0);
    });
  });

  group('ExposureSummary', () {
    test('fromJson converts the byAsset map into a list, keyed by symbol', () {
      final summary = ExposureSummary.fromJson({
        'openPositions': 2,
        'totalNotionalUsd': 800,
        'totalMarginUsd': 160,
        'exposurePctOfBalance': 32,
        'futuresPositions': 1,
        'nearLiquidationCount': 0,
        'byAsset': {
          'BTCUSDT': {'notionalUsd': 300, 'count': 1, 'concentrationPct': 37.5},
          'ETHUSDT': {'notionalUsd': 500, 'count': 1, 'concentrationPct': 62.5},
        },
        'concentratedDirectionWarning': false,
      });

      expect(summary.byAsset.length, 2);
      expect(summary.byAsset.map((a) => a.asset), containsAll(['BTCUSDT', 'ETHUSDT']));
    });

    test('fromJson sorts byAsset by notional descending', () {
      final summary = ExposureSummary.fromJson({
        'byAsset': {
          'SMALL': {'notionalUsd': 100, 'count': 1, 'concentrationPct': 10},
          'BIG':   {'notionalUsd': 900, 'count': 1, 'concentrationPct': 90},
          'MID':   {'notionalUsd': 500, 'count': 1, 'concentrationPct': 50},
        },
      });

      expect(summary.byAsset.map((a) => a.asset).toList(), ['BIG', 'MID', 'SMALL']);
    });

    test('fromJson defaults to an empty, zeroed-out summary when byAsset is absent', () {
      final summary = ExposureSummary.fromJson({});
      expect(summary.openPositions, 0);
      expect(summary.totalNotionalUsd, 0);
      expect(summary.byAsset, isEmpty);
      expect(summary.concentratedDirectionWarning, isFalse);
      expect(summary.dominantDirection, isNull);
    });

    test('fromJson carries through the concentration warning and dominant direction', () {
      final summary = ExposureSummary.fromJson({
        'concentratedDirectionWarning': true,
        'dominantDirection': 'LONG',
      });
      expect(summary.concentratedDirectionWarning, isTrue);
      expect(summary.dominantDirection, 'LONG');
    });
  });
}
