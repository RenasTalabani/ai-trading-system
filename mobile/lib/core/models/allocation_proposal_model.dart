// Mirrors backend/src/models/AllocationProposal.js -- master-plan decision
// #14: the AI worker cycle never opens a trade directly. It proposes 2-4
// allocation options (one flagged as its recommendation); approving picks
// exactly one option's allocations to become real (paper) trades.
class ProposalAllocation {
  final String asset;
  final String direction; // BUY or SELL
  final double amountUsd;
  final double entryPrice;
  final double? stopLoss;
  final double? takeProfit;
  final String aiDecisionId;

  const ProposalAllocation({
    required this.asset,
    required this.direction,
    required this.amountUsd,
    required this.entryPrice,
    this.stopLoss,
    this.takeProfit,
    required this.aiDecisionId,
  });

  factory ProposalAllocation.fromJson(Map<String, dynamic> json) => ProposalAllocation(
    asset:        json['asset'] as String,
    direction:    json['direction'] as String,
    amountUsd:    (json['amountUsd'] as num).toDouble(),
    entryPrice:   (json['entryPrice'] as num).toDouble(),
    stopLoss:     (json['stopLoss'] as num?)?.toDouble(),
    takeProfit:   (json['takeProfit'] as num?)?.toDouble(),
    aiDecisionId: json['aiDecisionId'].toString(),
  );
}

class ProposalOption {
  final String key; // e.g. 'best_single', 'diversified', 'single_SOL'
  final String label; // human-readable, shown directly on the card
  final bool isRecommended;
  final double totalUsd;
  final List<ProposalAllocation> allocations;

  const ProposalOption({
    required this.key,
    required this.label,
    required this.isRecommended,
    required this.totalUsd,
    required this.allocations,
  });

  factory ProposalOption.fromJson(Map<String, dynamic> json) => ProposalOption(
    key:           json['key'] as String,
    label:         json['label'] as String,
    isRecommended: json['isRecommended'] as bool? ?? false,
    totalUsd:      (json['totalUsd'] as num).toDouble(),
    allocations: (json['allocations'] as List? ?? const [])
        .map((e) => ProposalAllocation.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

class AllocationProposalModel {
  final String id;
  final List<ProposalOption> options;
  final String status; // PENDING_APPROVAL | APPROVED | REJECTED | EXPIRED
  final String? chosenOptionKey;

  const AllocationProposalModel({
    required this.id,
    required this.options,
    required this.status,
    this.chosenOptionKey,
  });

  factory AllocationProposalModel.fromJson(Map<String, dynamic> json) => AllocationProposalModel(
    id: (json['_id'] ?? json['id']).toString(),
    options: (json['options'] as List? ?? const [])
        .map((e) => ProposalOption.fromJson(e as Map<String, dynamic>))
        .toList(),
    status:          json['status'] as String? ?? 'PENDING_APPROVAL',
    chosenOptionKey: json['chosenOptionKey'] as String?,
  );
}
