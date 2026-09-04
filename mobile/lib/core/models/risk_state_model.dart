// Mirrors backend/src/models/RiskState.js -- master-plan decision #16
// (Decision Log, 2026-09-03): a persistent, portfolio-wide daily-loss
// circuit breaker that only ever clears via an explicit human action
// (POST /virtual/risk-state/reset), never on its own.
class RiskStateModel {
  final String riskKey;
  final bool dailyLossHalted;
  final DateTime? haltedAt;
  final String? haltReason;
  final double? dailyLossAtHalt; // $ amount that triggered the halt
  final String? haltDayKey; // UTC yyyy-mm-dd the halt happened on
  final DateTime? resetAt;
  final String? resetBy;

  const RiskStateModel({
    required this.riskKey,
    required this.dailyLossHalted,
    this.haltedAt,
    this.haltReason,
    this.dailyLossAtHalt,
    this.haltDayKey,
    this.resetAt,
    this.resetBy,
  });

  factory RiskStateModel.fromJson(Map<String, dynamic> json) => RiskStateModel(
    riskKey:         json['riskKey'] as String? ?? 'global',
    dailyLossHalted: json['dailyLossHalted'] as bool? ?? false,
    haltedAt:        json['haltedAt'] != null ? DateTime.tryParse(json['haltedAt'] as String) : null,
    haltReason:      json['haltReason'] as String?,
    dailyLossAtHalt: (json['dailyLossAtHalt'] as num?)?.toDouble(),
    haltDayKey:      json['haltDayKey'] as String?,
    resetAt:         json['resetAt'] != null ? DateTime.tryParse(json['resetAt'] as String) : null,
    resetBy:         json['resetBy'] as String?,
  );

  // Safe default used before the first successful fetch (and only there) --
  // treated as "not halted" so the safety banner never flashes red because
  // of a slow/failed initial load. A real halt is only ever shown once the
  // backend has actually confirmed it.
  static const RiskStateModel notHalted = RiskStateModel(riskKey: 'global', dailyLossHalted: false);
}
