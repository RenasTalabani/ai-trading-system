import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../services/api_service.dart';

// ── Asset Ticker (24h stats) ─────────────────────────────────────────────────

class AssetTicker {
  final String asset;
  final double price;
  final double change24h;
  final double changePercent;
  final double high24h;
  final double low24h;
  final double volume24h;
  final double quoteVolume24h;

  const AssetTicker({
    required this.asset,
    required this.price,
    required this.change24h,
    required this.changePercent,
    required this.high24h,
    required this.low24h,
    required this.volume24h,
    required this.quoteVolume24h,
  });

  factory AssetTicker.fromJson(Map<String, dynamic> j) => AssetTicker(
    asset:          j['asset']?.toString()            ?? '',
    price:          (j['price']          as num?)?.toDouble() ?? 0,
    change24h:      (j['change24h']      as num?)?.toDouble() ?? 0,
    changePercent:  (j['changePercent']  as num?)?.toDouble() ?? 0,
    high24h:        (j['high24h']        as num?)?.toDouble() ?? 0,
    low24h:         (j['low24h']         as num?)?.toDouble() ?? 0,
    volume24h:      (j['volume24h']      as num?)?.toDouble() ?? 0,
    quoteVolume24h: (j['quoteVolume24h'] as num?)?.toDouble() ?? 0,
  );

  bool get isUp => changePercent >= 0;
}

// Per-asset ticker provider (auto-refreshes on watch)
final assetTickerProvider =
    FutureProvider.autoDispose.family<AssetTicker, String>((ref, asset) async {
  if (asset.isEmpty) throw Exception('empty asset');
  final resp = await ApiService.dio.get('market/ticker/$asset');
  return AssetTicker.fromJson(resp.data as Map<String, dynamic>);
});

// Batch ticker provider for an entire watchlist
final batchTickerProvider =
    FutureProvider.autoDispose.family<List<AssetTicker>, List<String>>((ref, assets) async {
  if (assets.isEmpty) return [];
  try {
    final resp = await ApiService.dio.post('market/tickers',
        data: {'assets': assets});
    final list = resp.data['tickers'] as List? ?? [];
    return list.map((j) => AssetTicker.fromJson(j as Map<String, dynamic>)).toList();
  } catch (_) {
    return [];
  }
});

// ── Display name helpers ─────────────────────────────────────────────────────

const _displayNames = {
  'BTCUSDT':  'Bitcoin',
  'ETHUSDT':  'Ethereum',
  'BNBUSDT':  'BNB',
  'SOLUSDT':  'Solana',
  'XRPUSDT':  'Ripple',
  'ADAUSDT':  'Cardano',
  'DOGEUSDT': 'Dogecoin',
  'AVAXUSDT': 'Avalanche',
  'LINKUSDT': 'Chainlink',
  'MATICUSDT':'Polygon',
  'DOTUSDT':  'Polkadot',
  'LTCUSDT':  'Litecoin',
  'UNIUSDT':  'Uniswap',
  'ATOMUSDT': 'Cosmos',
  'NEARUSDT': 'NEAR',
  'APTUSDT':  'Aptos',
  'ARBUSDT':  'Arbitrum',
  'OPUSDT':   'Optimism',
  'INJUSDT':  'Injective',
  'SUIUSDT':  'Sui',
};

String displayNameFor(String asset) =>
    _displayNames[asset.toUpperCase()] ?? asset.replaceAll('USDT', '').replaceAll('usdt', '');

String symbolFor(String asset) =>
    asset.toUpperCase().replaceAll('USDT', '');

const allSupportedAssets = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT',
  'DOTUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'NEARUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT',
];

// ── Watchlist state ─────────────────────────────────────────────────────────

class WatchlistNotifier extends StateNotifier<List<String>> {
  static const _key  = 'watchlist_assets_v1';
  static const _storage = FlutterSecureStorage();

  WatchlistNotifier() : super(const [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  ]) {
    _load();
  }

  Future<void> _load() async {
    final saved = await _storage.read(key: _key);
    if (saved != null) {
      final list = (jsonDecode(saved) as List).cast<String>();
      if (list.isNotEmpty) state = list;
    }
  }

  Future<void> _persist() async {
    await _storage.write(key: _key, value: jsonEncode(state));
  }

  Future<void> add(String asset) async {
    final a = asset.toUpperCase();
    if (state.contains(a)) return;
    state = [...state, a];
    await _persist();
  }

  Future<void> remove(String asset) async {
    state = state.where((a) => a != asset.toUpperCase()).toList();
    await _persist();
  }

  bool contains(String asset) => state.contains(asset.toUpperCase());

  Future<void> reorder(int oldIndex, int newIndex) async {
    final list = [...state];
    final item = list.removeAt(oldIndex);
    final insertAt = newIndex > oldIndex ? newIndex - 1 : newIndex;
    list.insert(insertAt, item);
    state = list;
    await _persist();
  }
}

final watchlistProvider =
    StateNotifierProvider<WatchlistNotifier, List<String>>((_) => WatchlistNotifier());
