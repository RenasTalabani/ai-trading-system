import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/providers/prices_provider.dart';
import '../../../core/theme/app_theme.dart';

class PriceTickerBar extends ConsumerWidget {
  static const _assets = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
    'XRPUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT',
  ];

  const PriceTickerBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prices = ref.watch(pricesProvider);

    return Container(
      height: 44,
      color: AppColors.surface,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _assets.length,
        separatorBuilder: (_, __) => const VerticalDivider(
          color: AppColors.border, width: 24, indent: 8, endIndent: 8,
        ),
        itemBuilder: (_, i) {
          final asset = _assets[i];
          final price = prices[asset];
          final base  = asset.replaceAll('USDT', '').replaceAll('USD', '');
          final fmt   = NumberFormat('#,##0.##');

          return Center(child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(base,
                  style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
              const SizedBox(width: 6),
              if (price != null)
                Text('\$${fmt.format(price)}',
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary))
              else
                Container(width: 40, height: 10,
                    decoration: BoxDecoration(
                      color: AppColors.border,
                      borderRadius: BorderRadius.circular(4),
                    )),
            ],
          ));
        },
      ),
    );
  }
}
