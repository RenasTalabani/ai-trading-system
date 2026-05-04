import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class PriceAlertModel {
  final String  id;
  final String  asset;
  final String  displayName;
  final double  targetPrice;
  final String  direction;  // above | below
  final bool    active;
  final String  note;
  final DateTime? triggeredAt;
  final DateTime  createdAt;

  const PriceAlertModel({
    required this.id,
    required this.asset,
    required this.displayName,
    required this.targetPrice,
    required this.direction,
    required this.active,
    required this.note,
    required this.createdAt,
    this.triggeredAt,
  });

  factory PriceAlertModel.fromJson(Map<String, dynamic> j) => PriceAlertModel(
    id:          j['_id']?.toString()          ?? '',
    asset:       j['asset']?.toString()        ?? '',
    displayName: j['displayName']?.toString()  ?? j['asset']?.toString() ?? '',
    targetPrice: (j['targetPrice'] as num?)?.toDouble() ?? 0.0,
    direction:   j['direction']?.toString()    ?? 'above',
    active:      j['active'] as bool?          ?? true,
    note:        j['note']?.toString()         ?? '',
    createdAt:   DateTime.tryParse(j['createdAt']?.toString() ?? '') ?? DateTime.now(),
    triggeredAt: j['triggeredAt'] != null
        ? DateTime.tryParse(j['triggeredAt'].toString()) : null,
  );
}

class PriceAlertsState {
  final List<PriceAlertModel> alerts;
  final bool    loading;
  final String? error;
  const PriceAlertsState({
    this.alerts = const [],
    this.loading = false,
    this.error,
  });
  PriceAlertsState copyWith({
    List<PriceAlertModel>? alerts,
    bool? loading,
    String? error,
  }) => PriceAlertsState(
    alerts:  alerts  ?? this.alerts,
    loading: loading ?? this.loading,
    error:   error,
  );
}

class PriceAlertsNotifier extends StateNotifier<PriceAlertsState> {
  PriceAlertsNotifier() : super(const PriceAlertsState()) {
    fetch();
  }

  Future<void> fetch() async {
    state = state.copyWith(loading: true);
    try {
      final resp = await ApiService.dio.get('price-alerts');
      final list = (resp.data['alerts'] as List)
          .map((a) => PriceAlertModel.fromJson(a as Map<String, dynamic>))
          .toList();
      state = state.copyWith(alerts: list, loading: false);
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
    }
  }

  Future<bool> create({
    required String asset,
    required String displayName,
    required double targetPrice,
    required String direction,
    String note = '',
  }) async {
    try {
      await ApiService.dio.post('price-alerts', data: {
        'asset':       asset,
        'displayName': displayName,
        'targetPrice': targetPrice,
        'direction':   direction,
        'note':        note,
      });
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> delete(String id) async {
    state = state.copyWith(
      alerts: state.alerts.where((a) => a.id != id).toList(),
    );
    try { await ApiService.dio.delete('price-alerts/$id'); } catch (_) {}
  }

  Future<void> toggle(String id) async {
    final idx = state.alerts.indexWhere((a) => a.id == id);
    if (idx < 0) return;
    try { await ApiService.dio.patch('price-alerts/$id/toggle'); } catch (_) {}
    await fetch();
  }
}

final priceAlertsProvider =
    StateNotifierProvider<PriceAlertsNotifier, PriceAlertsState>(
        (_) => PriceAlertsNotifier());
