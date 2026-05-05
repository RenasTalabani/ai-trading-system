import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/brain_provider.dart';
import '../../core/theme/app_theme.dart';

void showRiskCalculatorSheet(
  BuildContext context, {
  double? entryPrice,
  double? stopLoss,
  double? takeProfit,
  String? asset,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _RiskCalcSheet(
      entryPrice: entryPrice,
      stopLoss:   stopLoss,
      takeProfit: takeProfit,
      asset:      asset,
    ),
  );
}

class _RiskCalcSheet extends ConsumerStatefulWidget {
  final double? entryPrice;
  final double? stopLoss;
  final double? takeProfit;
  final String? asset;

  const _RiskCalcSheet({
    this.entryPrice, this.stopLoss, this.takeProfit, this.asset,
  });

  @override
  ConsumerState<_RiskCalcSheet> createState() => _RiskCalcSheetState();
}

class _RiskCalcSheetState extends ConsumerState<_RiskCalcSheet> {
  late final TextEditingController _entryCtrl;
  late final TextEditingController _slCtrl;
  late final TextEditingController _tpCtrl;
  double _riskPercent = 2.0;

  @override
  void initState() {
    super.initState();
    _entryCtrl = TextEditingController(
        text: widget.entryPrice != null ? _fmt(widget.entryPrice!) : '');
    _slCtrl = TextEditingController(
        text: widget.stopLoss != null ? _fmt(widget.stopLoss!) : '');
    _tpCtrl = TextEditingController(
        text: widget.takeProfit != null ? _fmt(widget.takeProfit!) : '');
  }

  @override
  void dispose() {
    _entryCtrl.dispose();
    _slCtrl.dispose();
    _tpCtrl.dispose();
    super.dispose();
  }

  String _fmt(double v) {
    if (v >= 10000) return v.toStringAsFixed(0);
    if (v >= 100)   return v.toStringAsFixed(1);
    return v.toStringAsFixed(2);
  }

  _CalcResult? get _result {
    final balance  = ref.read(brainBalanceProvider);
    final entry    = double.tryParse(_entryCtrl.text.trim());
    final sl       = double.tryParse(_slCtrl.text.trim());
    final tp       = double.tryParse(_tpCtrl.text.trim());

    if (entry == null || entry <= 0) return null;
    if (sl == null || sl <= 0)       return null;

    final riskAmt    = balance * (_riskPercent / 100);
    final slDist     = (entry - sl).abs();
    if (slDist <= 0) return null;

    final units      = riskAmt / slDist;
    final positionSz = units * entry;
    final rr         = tp != null ? (tp - entry).abs() / slDist : null;
    final tpProfit   = tp != null ? units * (tp - entry).abs() : null;

    return _CalcResult(
      riskAmount:  riskAmt,
      units:       units,
      positionSz:  positionSz,
      rr:          rr,
      tpProfit:    tpProfit,
      balance:     balance,
    );
  }

  @override
  Widget build(BuildContext context) {
    final balance = ref.watch(brainBalanceProvider);
    final result  = _result;

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize:     0.5,
      maxChildSize:     0.95,
      expand: false,
      builder: (_, ctrl) => Column(children: [
        // Handle
        const SizedBox(height: 12),
        Container(width: 40, height: 4,
            decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(2))),
        const SizedBox(height: 16),

        // Header
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.calculate_outlined,
                  size: 18, color: AppColors.primary),
            ),
            const SizedBox(width: 10),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Risk Calculator',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              if (widget.asset != null)
                Text(widget.asset!,
                    style: const TextStyle(fontSize: 11,
                        color: AppColors.textMuted)),
            ]),
          ]),
        ),
        const SizedBox(height: 16),

        Expanded(child: ListView(
          controller: ctrl,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: [

            // Account balance (read-only from provider)
            _InfoRow(
              label: 'Account Balance',
              value: '\$${balance.toStringAsFixed(0)}',
              note: 'Change in Portfolio tab',
            ),
            const SizedBox(height: 16),

            // Risk % slider
            _SliderCard(
              label: 'Risk Per Trade',
              value: _riskPercent,
              formatted: '${_riskPercent.toStringAsFixed(1)}%'
                  '  (\$${(balance * _riskPercent / 100).toStringAsFixed(2)})',
              min: 0.5, max: 5.0, divisions: 9,
              onChanged: (v) => setState(() => _riskPercent = v),
            ),
            const SizedBox(height: 16),

            // Price inputs
            const _Label('Trade Levels'),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _PriceField(
                  ctrl: _entryCtrl,
                  label: 'Entry',
                  color: AppColors.primary,
                  onChanged: (_) => setState(() {}))),
              const SizedBox(width: 8),
              Expanded(child: _PriceField(
                  ctrl: _slCtrl,
                  label: 'Stop Loss',
                  color: AppColors.sell,
                  onChanged: (_) => setState(() {}))),
              const SizedBox(width: 8),
              Expanded(child: _PriceField(
                  ctrl: _tpCtrl,
                  label: 'Take Profit',
                  color: AppColors.buy,
                  onChanged: (_) => setState(() {}))),
            ]),
            const SizedBox(height: 20),

            // Result card
            if (result != null) _ResultCard(result: result)
            else Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: const Center(
                child: Text('Enter entry & stop loss prices to calculate',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12,
                        color: AppColors.textMuted)),
              ),
            ),
          ],
        )),
      ]),
    );
  }
}

// ── Result card ───────────────────────────────────────────────────────────────

class _CalcResult {
  final double riskAmount;
  final double units;
  final double positionSz;
  final double? rr;
  final double? tpProfit;
  final double balance;
  const _CalcResult({
    required this.riskAmount, required this.units, required this.positionSz,
    required this.balance, this.rr, this.tpProfit,
  });
}

class _ResultCard extends StatelessWidget {
  final _CalcResult r;
  const _ResultCard({required this.result}) : r = result;
  final _CalcResult result;

  String _fmtUnits(double v) {
    if (v >= 1000) return v.toStringAsFixed(0);
    if (v >= 1)    return v.toStringAsFixed(3);
    return v.toStringAsFixed(6);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
      ),
      child: Column(children: [
        // Main result
        Padding(
          padding: const EdgeInsets.all(20),
          child: Row(children: [
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Position Size',
                    style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                const SizedBox(height: 4),
                Text('\$${r.positionSz.toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 28,
                        fontWeight: FontWeight.w900,
                        color: AppColors.textPrimary)),
                Text('${_fmtUnits(r.units)} units',
                    style: const TextStyle(fontSize: 12,
                        color: AppColors.textSecondary)),
              ],
            )),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              const Text('Max Risk',
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
              const SizedBox(height: 4),
              Text('-\$${r.riskAmount.toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: AppColors.sell)),
              Text('${(r.riskAmount / r.balance * 100).toStringAsFixed(1)}% of balance',
                  style: const TextStyle(fontSize: 10,
                      color: AppColors.textMuted)),
            ]),
          ]),
        ),

        if (r.rr != null || r.tpProfit != null) ...[
          const Divider(color: AppColors.border, height: 1),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              if (r.rr != null) ...[
                Expanded(child: _ResRow(
                  label: 'Risk:Reward',
                  value: '1 : ${r.rr!.toStringAsFixed(1)}',
                  color: r.rr! >= 2 ? AppColors.buy : AppColors.hold,
                )),
              ],
              if (r.tpProfit != null) ...[
                if (r.rr != null) const SizedBox(width: 16),
                Expanded(child: _ResRow(
                  label: 'Potential Profit',
                  value: '+\$${r.tpProfit!.toStringAsFixed(2)}',
                  color: AppColors.buy,
                )),
              ],
            ]),
          ),
        ],

        // Risk level indicator
        const Divider(color: AppColors.border, height: 1),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
          child: _RiskLevelBar(pct: r.positionSz / r.balance * 100),
        ),
      ]),
    );
  }
}

class _ResRow extends StatelessWidget {
  final String label;
  final String value;
  final Color  color;
  const _ResRow({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label,
          style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
      const SizedBox(height: 3),
      Text(value,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800,
              color: color)),
    ],
  );
}

class _RiskLevelBar extends StatelessWidget {
  final double pct; // position as % of balance
  const _RiskLevelBar({required this.pct});

  String get _label {
    if (pct < 20)  return 'Conservative';
    if (pct < 50)  return 'Moderate';
    if (pct < 100) return 'Aggressive';
    return 'Very High';
  }

  Color get _color {
    if (pct < 20)  return AppColors.buy;
    if (pct < 50)  return AppColors.hold;
    if (pct < 100) return const Color(0xFFF59E0B);
    return AppColors.sell;
  }

  @override
  Widget build(BuildContext context) => Row(children: [
    Text('Leverage level: $_label',
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600,
            color: _color)),
    const Spacer(),
    Text('${pct.toStringAsFixed(0)}% of balance',
        style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
  ]);
}

// ── Small components ──────────────────────────────────────────────────────────

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final String note;
  const _InfoRow({required this.label, required this.value, required this.note});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.background,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.border),
    ),
    child: Row(children: [
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 11,
            color: AppColors.textMuted)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontSize: 18,
            fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
      ]),
      const Spacer(),
      Text(note, style: const TextStyle(fontSize: 10,
          color: AppColors.textMuted)),
    ]),
  );
}

class _SliderCard extends StatelessWidget {
  final String  label;
  final double  value;
  final String  formatted;
  final double  min;
  final double  max;
  final int     divisions;
  final ValueChanged<double> onChanged;
  const _SliderCard({
    required this.label, required this.value, required this.formatted,
    required this.min, required this.max, required this.divisions,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
    decoration: BoxDecoration(
      color: AppColors.background,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Text(label, style: const TextStyle(fontSize: 12,
            color: AppColors.textSecondary)),
        const Spacer(),
        Text(formatted, style: const TextStyle(fontSize: 13,
            fontWeight: FontWeight.w700, color: AppColors.primary)),
      ]),
      Slider(
        value: value, min: min, max: max, divisions: divisions,
        activeColor: AppColors.primary,
        inactiveColor: AppColors.border,
        onChanged: onChanged,
      ),
    ]),
  );
}

class _PriceField extends StatelessWidget {
  final TextEditingController ctrl;
  final String label;
  final Color  color;
  final ValueChanged<String> onChanged;
  const _PriceField({
    required this.ctrl, required this.label,
    required this.color, required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
          color: color)),
      const SizedBox(height: 4),
      TextField(
        controller: ctrl,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
        onChanged: onChanged,
        decoration: InputDecoration(
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          filled: true,
          fillColor: AppColors.background,
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide(color: color.withValues(alpha: 0.3)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide(color: color, width: 1.5),
          ),
          hintText: '0.00',
          hintStyle: const TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
      ),
    ],
  );
}

class _Label extends StatelessWidget {
  final String text;
  const _Label(this.text);

  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
          color: AppColors.textMuted, letterSpacing: 1.1));
}
