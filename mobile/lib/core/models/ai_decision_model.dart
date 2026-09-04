// Mirrors one AIDecision document from GET /api/v1/ai-brain/decisions
// (master-plan decision #21's secondary history panel). This is a read-only
// log view -- no approve/reject actions live here; those only ever happen
// from the single main screen's live pending-proposal card, before a
// decision ages into this history at all.
class AIDecisionModel {
  final String id;
  final String asset;
  final String displayName;
  final String action; // BUY / SELL / HOLD
  final double confidence;
  final double? entryPrice;
  final double? stopLoss;
  final double? takeProfit;
  final String? reason;
  final String status; // PENDING_APPROVAL / APPROVED / REJECTED / EXPIRED
  final String result; // WIN / LOSS / OPEN / SKIPPED
  final double? profitPct;
  final List<String> safetyGateReasons;
  final DateTime createdAt;
  final DateTime? decidedAt;
  final DateTime? closedAt;

  const AIDecisionModel({
    required this.id,
    required this.asset,
    required this.displayName,
    required this.action,
    required this.confidence,
    this.entryPrice,
    this.stopLoss,
    this.takeProfit,
    this.reason,
    required this.status,
    required this.result,
    this.profitPct,
    this.safetyGateReasons = const [],
    required this.createdAt,
    this.decidedAt,
    this.closedAt,
  });

  factory AIDecisionModel.fromJson(Map<String, dynamic> j) => AIDecisionModel(
    id:          (j['_id'] ?? j['id']).toString(),
    asset:       j['asset'] as String? ?? '',
    displayName: (j['displayName'] as String?)?.isNotEmpty == true
        ? j['displayName'] as String
        : (j['asset'] as String? ?? '').replaceAll('USDT', ''),
    action:      j['action'] as String? ?? 'HOLD',
    confidence:  (j['confidence'] as num?)?.toDouble() ?? 0,
    entryPrice:  (j['entryPrice'] as num?)?.toDouble(),
    stopLoss:    (j['stopLoss'] as num?)?.toDouble(),
    takeProfit:  (j['takeProfit'] as num?)?.toDouble(),
    reason:      j['reason'] as String?,
    status:      j['status'] as String? ?? 'PENDING_APPROVAL',
    result:      j['result'] as String? ?? 'OPEN',
    profitPct:   (j['profitPct'] as num?)?.toDouble(),
    safetyGateReasons: (j['safetyGateReasons'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    createdAt:   DateTime.tryParse(j['createdAt'] as String? ?? '') ?? DateTime.now(),
    decidedAt:   j['decidedAt'] != null ? DateTime.tryParse(j['decidedAt'] as String) : null,
    closedAt:    j['closedAt'] != null ? DateTime.tryParse(j['closedAt'] as String) : null,
  );
}
