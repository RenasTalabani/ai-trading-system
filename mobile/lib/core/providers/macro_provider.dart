import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class MacroSnapshot {
  final int    fearGreedValue;
  final String fearGreedClass;
  final double btcDominance;
  final double marketCapChange24h;
  final String macroSentiment;
  final String macroBias;
  final double btcFundingRate;
  final double ethFundingRate;

  const MacroSnapshot({
    required this.fearGreedValue,
    required this.fearGreedClass,
    required this.btcDominance,
    required this.marketCapChange24h,
    required this.macroSentiment,
    required this.macroBias,
    required this.btcFundingRate,
    required this.ethFundingRate,
  });

  factory MacroSnapshot.fromJson(Map<String, dynamic> j) {
    final fg      = j['fear_greed']    as Map? ?? {};
    final gc      = j['global_crypto'] as Map? ?? {};
    final fr      = j['funding_rates'] as Map? ?? {};
    final btcFr   = fr['BTCUSDT']      as Map? ?? {};
    final ethFr   = fr['ETHUSDT']      as Map? ?? {};
    return MacroSnapshot(
      fearGreedValue:     (fg['value']          as num?)?.toInt()    ?? 50,
      fearGreedClass:     fg['classification']?.toString()            ?? 'Neutral',
      btcDominance:       (gc['btc_dominance']   as num?)?.toDouble() ?? 0.0,
      marketCapChange24h: (gc['market_cap_change_24h'] as num?)?.toDouble() ?? 0.0,
      macroSentiment:     j['macro_sentiment']?.toString()            ?? 'neutral',
      macroBias:          j['macro_bias']?.toString()                  ?? 'neutral',
      btcFundingRate:     (btcFr['funding_rate']  as num?)?.toDouble() ?? 0.0,
      ethFundingRate:     (ethFr['funding_rate']  as num?)?.toDouble() ?? 0.0,
    );
  }
}

final macroProvider = FutureProvider<MacroSnapshot>((ref) async {
  final resp = await ApiService.dio.get('macro/snapshot');
  return MacroSnapshot.fromJson(resp.data as Map<String, dynamic>);
});
