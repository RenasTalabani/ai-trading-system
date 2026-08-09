class AssetExposure {
  final String asset;
  final double notionalUsd;
  final int count;
  final double concentrationPct;

  const AssetExposure({
    required this.asset,
    required this.notionalUsd,
    required this.count,
    required this.concentrationPct,
  });

  factory AssetExposure.fromJson(String asset, Map<String, dynamic> j) => AssetExposure(
        asset: asset,
        notionalUsd: (j['notionalUsd'] ?? 0).toDouble(),
        count: (j['count'] ?? 0) as int,
        concentrationPct: (j['concentrationPct'] ?? 0).toDouble(),
      );
}

class ExposureSummary {
  final int openPositions;
  final double totalNotionalUsd;
  final double totalMarginUsd;
  final double exposurePctOfBalance;
  final int futuresPositions;
  final int nearLiquidationCount;
  final List<AssetExposure> byAsset;
  final bool concentratedDirectionWarning;
  final String? dominantDirection;

  const ExposureSummary({
    required this.openPositions,
    required this.totalNotionalUsd,
    required this.totalMarginUsd,
    required this.exposurePctOfBalance,
    required this.futuresPositions,
    required this.nearLiquidationCount,
    required this.byAsset,
    required this.concentratedDirectionWarning,
    this.dominantDirection,
  });

  factory ExposureSummary.fromJson(Map<String, dynamic> j) {
    final byAssetJson = (j['byAsset'] as Map<String, dynamic>? ?? {});
    return ExposureSummary(
      openPositions:    (j['openPositions']        ?? 0) as int,
      totalNotionalUsd: (j['totalNotionalUsd']      ?? 0).toDouble(),
      totalMarginUsd:   (j['totalMarginUsd']        ?? 0).toDouble(),
      exposurePctOfBalance: (j['exposurePctOfBalance'] ?? 0).toDouble(),
      futuresPositions: (j['futuresPositions']      ?? 0) as int,
      nearLiquidationCount: (j['nearLiquidationCount'] ?? 0) as int,
      byAsset: byAssetJson.entries
          .map((e) => AssetExposure.fromJson(e.key, e.value as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => b.notionalUsd.compareTo(a.notionalUsd)),
      concentratedDirectionWarning: (j['concentratedDirectionWarning'] ?? false) as bool,
      dominantDirection: j['dominantDirection'],
    );
  }
}
