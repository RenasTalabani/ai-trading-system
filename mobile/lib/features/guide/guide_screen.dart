import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/guide_provider.dart';
import '../../core/providers/positions_guidance_provider.dart';
import '../../core/theme/app_theme.dart';

// The "just tell me what to do" screen — one suggestion at a time, plain
// language, nothing happens without a tap. Built for someone who doesn't
// understand trading and doesn't want to: no indicators, no percentages
// beyond a simple risk label, no charts.
class GuideScreen extends ConsumerWidget {
  const GuideScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(guideProvider);
    final positionsState = ref.watch(positionsGuidanceProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        leadingWidth: 52,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.asset('assets/images/reno-mark.png',
                width: 28, height: 28, fit: BoxFit.cover),
          ),
        ),
        title: const Text('What Should I Do?',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                color: AppColors.textPrimary)),
      ),
      body: RefreshIndicator(
        onRefresh: () => Future.wait([
          ref.read(guideProvider.notifier).fetch(),
          ref.read(positionsGuidanceProvider.notifier).fetch(),
        ]),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
          children: [
            if (positionsState.positions.isNotEmpty) ...[
              _RiskSummaryBanner(
                totalAtRiskUsd: positionsState.totalAtRiskUsd,
                totalAtRiskPct: positionsState.totalAtRiskPct,
                positionsWithoutStopLoss: positionsState.positionsWithoutStopLoss,
                totalPotentialGainUsd: positionsState.totalPotentialGainUsd,
                totalPotentialGainPct: positionsState.totalPotentialGainPct,
                positionsWithoutTakeProfit: positionsState.positionsWithoutTakeProfit,
              ),
              const SizedBox(height: 20),
            ],

            if (state.loading)
              const _LoadingCard()
            else if (state.suggestion != null)
              _SuggestionCard(suggestion: state.suggestion!, approving: state.approving)
            else if (state.lastResultMessage == null)
              _EmptyCard(message: state.unavailableMessage ?? state.error ?? 'Nothing to show right now.'),

            if (state.lastResultMessage != null) ...[
              const SizedBox(height: 16),
              _ResultBanner(message: state.lastResultMessage!),
            ],
            if (state.error != null && state.suggestion != null) ...[
              const SizedBox(height: 16),
              _ErrorBanner(message: state.error!),
            ],

            if (positionsState.positions.isNotEmpty || positionsState.lastSellMessage != null) ...[
              const SizedBox(height: 32),
              const Text('Your Positions',
                  style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              if (positionsState.lastSellMessage != null) ...[
                _ResultBanner(message: positionsState.lastSellMessage!),
                const SizedBox(height: 10),
              ],
              ...positionsState.positions.map((p) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _PositionTile(
                      position: p,
                      selling: positionsState.sellingTradeId == p.tradeId,
                    ),
                  )),
            ],

            const SizedBox(height: 24),
            const Text(
              'This is practice money only — nothing here is real. '
              'The AI suggests, you decide.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textMuted, fontSize: 12, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _SuggestionCard extends ConsumerWidget {
  final GuideSuggestion suggestion;
  final bool approving;
  const _SuggestionCard({required this.suggestion, required this.approving});

  Color _riskColor(String level) {
    switch (level) {
      case 'Low':    return AppColors.success;
      case 'Medium': return AppColors.warning;
      default:       return AppColors.error;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // T-066: `decision` is the AI's WAIT/AVOID-aware label (matches the
    // /predict pipeline, T-065) -- `action` (BUY/SELL) is what still drives
    // approve()'s actual trade direction, completely unchanged. AVOID means
    // the models found a BUY/SELL lean but flagged a real risk (e.g. social
    // manipulation) -- shown distinctly, not hidden or silently blocked.
    final isAvoid = suggestion.decision == 'AVOID';
    final actionColor = isAvoid
        ? AppColors.warning
        : (suggestion.action == 'BUY' ? AppColors.buy : AppColors.sell);
    final actionWord   = suggestion.action == 'BUY' ? 'Buy' : 'Sell';
    final riskColor    = _riskColor(suggestion.riskLevel);

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text("Today's Suggestion",
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),

          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: actionColor, borderRadius: BorderRadius.circular(8)),
                child: Text(
                  isAvoid ? '${actionWord.toUpperCase()} · FLAGGED' : actionWord.toUpperCase(),
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 14),
                ),
              ),
              const SizedBox(width: 10),
              Text('\$${suggestion.amountUsd.toStringAsFixed(0)}',
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 22, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 4),
          Text(suggestion.displayName,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.w700)),

          if (isAvoid) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
              ),
              child: const Text(
                '⚠️ The AI found a lean here, but flagged a real risk (e.g. unusual social activity) — read carefully before acting.',
                style: TextStyle(color: AppColors.warning, fontSize: 13, fontWeight: FontWeight.w600, height: 1.4),
              ),
            ),
          ],

          const SizedBox(height: 20),
          const Text('Why', style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          ...suggestion.why.map((line) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(line, style: const TextStyle(color: AppColors.textPrimary, fontSize: 15, height: 1.4)),
              )),
          Text('The AI is ${suggestion.confidenceWords} about this.',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),

          if (suggestion.maxLossUsd != null) ...[
            const SizedBox(height: 12),
            Text('If this goes wrong, you could lose about \$${suggestion.maxLossUsd!.toStringAsFixed(2)}.',
                style: const TextStyle(color: AppColors.error, fontSize: 13, fontWeight: FontWeight.w600)),
          ],
          if (suggestion.maxGainUsd != null) ...[
            const SizedBox(height: 4),
            Text('If this works out, you could gain about \$${suggestion.maxGainUsd!.toStringAsFixed(2)}.',
                style: const TextStyle(color: AppColors.success, fontSize: 13, fontWeight: FontWeight.w600)),
          ],

          const SizedBox(height: 20),
          Row(
            children: [
              const Text('Risk level:', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
              const SizedBox(width: 8),
              Container(width: 8, height: 8, decoration: BoxDecoration(color: riskColor, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text(suggestion.riskLevel,
                  style: TextStyle(color: riskColor, fontWeight: FontWeight.w700, fontSize: 14)),
            ],
          ),

          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: approving ? null : () {
                HapticFeedback.mediumImpact();
                ref.read(guideProvider.notifier).approve();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: isAvoid ? AppColors.warning : AppColors.primary,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: approving
                  ? const SizedBox(width: 22, height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : Text(isAvoid ? 'Do it anyway' : 'Yes, do it',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton(
              onPressed: approving ? null : () {
                HapticFeedback.selectionClick();
                ref.read(guideProvider.notifier).skip();
              },
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.border),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Skip', style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }
}

class _PositionTile extends ConsumerWidget {
  final PositionGuidance position;
  final bool selling;
  const _PositionTile({required this.position, required this.selling});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isSell = position.recommendation == 'SELL';
    final pnlColor = position.pnlPct >= 0 ? AppColors.success : AppColors.error;
    final pnlSign = position.pnlPct >= 0 ? '+' : '';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isSell ? AppColors.error.withValues(alpha: 0.4) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(position.asset,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w700)),
              const SizedBox(width: 8),
              Text('$pnlSign${position.pnlPct.toStringAsFixed(2)}%',
                  style: TextStyle(color: pnlColor, fontSize: 13, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (!isSell)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: AppColors.success, borderRadius: BorderRadius.circular(6)),
                  child: const Text('HOLD',
                      style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          for (final line in position.why)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(line,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4)),
            ),
          if (position.holdEstimate != null) ...[
            const SizedBox(height: 4),
            Text('How long: ${position.holdEstimate}',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w600)),
          ],
          if (position.maxLossUsd != null) ...[
            const SizedBox(height: 4),
            Text('Could lose up to \$${position.maxLossUsd!.toStringAsFixed(2)}',
                style: const TextStyle(color: AppColors.error, fontSize: 12, fontWeight: FontWeight.w600)),
          ],
          if (position.maxGainUsd != null) ...[
            const SizedBox(height: 4),
            Text('Could win up to \$${position.maxGainUsd!.toStringAsFixed(2)}',
                style: const TextStyle(color: AppColors.success, fontSize: 12, fontWeight: FontWeight.w600)),
          ],
          if (isSell) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 44,
              child: ElevatedButton(
                onPressed: selling ? null : () {
                  HapticFeedback.mediumImpact();
                  ref.read(positionsGuidanceProvider.notifier).sellNow(position.tradeId);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.error,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: selling
                    ? const SizedBox(width: 20, height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : const Text('Sell Now', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// Always visible whenever there's at least one open position -- a live,
// self-refreshing answer to "how much could I lose right now," computed
// from every open position's stop-loss (the honest worst-case if every one
// of them hit at once, not a prediction of what will actually happen).
// Always visible whenever there's at least one open position -- a live,
// self-refreshing answer to both "how much could I lose" and "how much
// could I win" right now, computed from every open position's stop-loss
// and take-profit (the honest worst-case / best-case if every one of them
// hit at once, not a prediction of what will actually happen).
class _RiskSummaryBanner extends StatelessWidget {
  final double totalAtRiskUsd;
  final double totalAtRiskPct;
  final int positionsWithoutStopLoss;
  final double totalPotentialGainUsd;
  final double totalPotentialGainPct;
  final int positionsWithoutTakeProfit;
  const _RiskSummaryBanner({
    required this.totalAtRiskUsd,
    required this.totalAtRiskPct,
    required this.positionsWithoutStopLoss,
    required this.totalPotentialGainUsd,
    required this.totalPotentialGainPct,
    required this.positionsWithoutTakeProfit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _RiskRewardColumn(
                  icon: Icons.shield_outlined,
                  label: 'Could lose',
                  amount: totalAtRiskUsd,
                  pct: totalAtRiskPct,
                  color: AppColors.error,
                ),
              ),
              Container(width: 1, height: 44, color: AppColors.border),
              Expanded(
                child: _RiskRewardColumn(
                  icon: Icons.trending_up,
                  label: 'Could win',
                  amount: totalPotentialGainUsd,
                  pct: totalPotentialGainPct,
                  color: AppColors.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            "If everything hit its worst case, or everything hit its best case — updates live.",
            style: TextStyle(color: AppColors.textMuted, fontSize: 12, height: 1.4),
          ),
          if (positionsWithoutStopLoss > 0) ...[
            const SizedBox(height: 6),
            Text(
              '$positionsWithoutStopLoss position${positionsWithoutStopLoss == 1 ? '' : 's'} '
              "have no stop-loss set, so ${positionsWithoutStopLoss == 1 ? 'its' : 'their'} downside isn't capped or counted above.",
              style: const TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
          if (positionsWithoutTakeProfit > 0) ...[
            const SizedBox(height: 4),
            Text(
              '$positionsWithoutTakeProfit position${positionsWithoutTakeProfit == 1 ? '' : 's'} '
              "have no target set, so ${positionsWithoutTakeProfit == 1 ? 'its' : 'their'} upside isn't counted above.",
              style: const TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ],
      ),
    );
  }
}

class _RiskRewardColumn extends StatelessWidget {
  final IconData icon;
  final String label;
  final double amount;
  final double pct;
  final Color color;
  const _RiskRewardColumn({
    required this.icon,
    required this.label,
    required this.amount,
    required this.pct,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 6),
            Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
          ],
        ),
        const SizedBox(height: 4),
        Text('\$${amount.toStringAsFixed(2)}',
            style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w800)),
        Text('${pct.toStringAsFixed(1)}% of balance',
            style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
      ],
    );
  }
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 80),
      alignment: Alignment.center,
      child: const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: AppColors.primary),
          SizedBox(height: 16),
          Text('Thinking…', style: TextStyle(color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  final String message;
  const _EmptyCard({required this.message});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          const Icon(Icons.psychology_outlined, size: 48, color: AppColors.textMuted),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.4)),
          const SizedBox(height: 20),
          const Text('Pull down to check again',
              style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
        ],
      ),
    );
  }
}

class _ResultBanner extends StatelessWidget {
  final String message;
  const _ResultBanner({required this.message});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.success.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.check_circle, color: AppColors.success, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14))),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner({required this.message});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.error.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14))),
        ],
      ),
    );
  }
}
