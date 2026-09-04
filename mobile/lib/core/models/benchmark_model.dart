// Mirrors the response shape of GET /api/v1/virtual/benchmark
// (virtualTrackingService.js's getBenchmarkComparison()) -- master-plan
// decision #22's graduation criterion, part 2: "outperforming a buy-and-hold
// BTC benchmark". Purely informational: this model (and the card built from
// it) never tells the user "go live now" -- it just states the two facts
// the plan asks for and lets the founder make that call themselves.
class BenchmarkComparisonModel {
  final bool available;
  final String? message; // set when available == false, explains why
  final DateTime? startedAt;
  final bool usedFallbackStartPrice;
  final int? daysElapsed;
  final double? weeksElapsed;
  final bool? minWeeksMet;
  final double? startingBalance;
  final double? currentBalance;
  final double? portfolioReturnPct;
  final double? btcPriceAtStart;
  final double? currentBtcPrice;
  final double? benchmarkValue;
  final double? benchmarkReturnPct;
  final bool? outperformingBenchmark;
  final bool? graduationCriteriaMet;

  const BenchmarkComparisonModel({
    required this.available,
    this.message,
    this.startedAt,
    this.usedFallbackStartPrice = false,
    this.daysElapsed,
    this.weeksElapsed,
    this.minWeeksMet,
    this.startingBalance,
    this.currentBalance,
    this.portfolioReturnPct,
    this.btcPriceAtStart,
    this.currentBtcPrice,
    this.benchmarkValue,
    this.benchmarkReturnPct,
    this.outperformingBenchmark,
    this.graduationCriteriaMet,
  });

  factory BenchmarkComparisonModel.fromJson(Map<String, dynamic> j) => BenchmarkComparisonModel(
    available: j['available'] as bool? ?? false,
    message:   j['message'] as String?,
    startedAt: j['startedAt'] != null ? DateTime.tryParse(j['startedAt'] as String) : null,
    usedFallbackStartPrice: j['usedFallbackStartPrice'] as bool? ?? false,
    daysElapsed:            j['daysElapsed'] as int?,
    weeksElapsed:           (j['weeksElapsed'] as num?)?.toDouble(),
    minWeeksMet:            j['minWeeksMet'] as bool?,
    startingBalance:        (j['startingBalance'] as num?)?.toDouble(),
    currentBalance:         (j['currentBalance'] as num?)?.toDouble(),
    portfolioReturnPct:     (j['portfolioReturnPct'] as num?)?.toDouble(),
    btcPriceAtStart:        (j['btcPriceAtStart'] as num?)?.toDouble(),
    currentBtcPrice:        (j['currentBtcPrice'] as num?)?.toDouble(),
    benchmarkValue:         (j['benchmarkValue'] as num?)?.toDouble(),
    benchmarkReturnPct:     (j['benchmarkReturnPct'] as num?)?.toDouble(),
    outperformingBenchmark: j['outperformingBenchmark'] as bool?,
    graduationCriteriaMet:  j['graduationCriteriaMet'] as bool?,
  );

  static const unavailable = BenchmarkComparisonModel(available: false);
}
