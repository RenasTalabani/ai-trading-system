// RENO Phase 3, steps 4-6 (2026-09-01) — the mobile RENO conversational
// screen: message history, an input bar, and, inline under RENO's own
// replies, real trade-plan/position/track-record cards built ONLY from
// backend tool-call results (never from parsing RENO's own prose).
//
// PREPARED, NOT VERIFIED. No Flutter/Dart toolchain was reachable from the
// environment that wrote this file (confirmed: `flutter`/`dart` not found,
// and no network path exists to install them). This has not been run
// through `flutter analyze`, `flutter test`, or a real build -- it is a
// careful, hand-written first draft, closely mirroring this app's existing
// screens (guide_screen.dart's card/button/color conventions, guide_provider
// .dart's StateNotifier pattern), meant for a session or person with real
// Flutter tooling to compile, run, and adjust. Do not treat this as a
// working, tested screen until someone with that tooling has built it.
//
// Design rules this file follows throughout (see reno_message_model.dart
// and reno_provider.dart for the data-layer half of the same rules):
//   - Only backend-returned fields are ever shown; a missing field renders
//     as an honest "not available" note, never a guessed number.
//   - Approving a trade is ONLY ever the dedicated Approve button, which
//     calls the dedicated backend endpoint. No amount of chat text --
//     "yes", "do it", anything typed into the message box -- is ever
//     interpreted as approval anywhere in this file.
//   - Paper trading is labeled, visibly, more than once.
//   - Potential (unrealized/target) figures and actual (realized, closed)
//     figures are always shown with distinct language, never blended.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers/reno_provider.dart';
import '../../core/models/reno_message_model.dart';
import '../../core/theme/app_theme.dart';

class RenoScreen extends ConsumerStatefulWidget {
  const RenoScreen({super.key});

  @override
  ConsumerState<RenoScreen> createState() => _RenoScreenState();
}

class _RenoScreenState extends ConsumerState<RenoScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottomSoon() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  void _send() {
    final text = _inputController.text;
    if (text.trim().isEmpty) return;
    HapticFeedback.selectionClick();
    _inputController.clear();
    ref.read(renoProvider.notifier).sendMessage(text);
    _scrollToBottomSoon();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(renoProvider);
    _scrollToBottomSoon();

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
        title: const Text('RENO',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800,
                color: AppColors.textPrimary)),
      ),
      body: Column(
        children: [
          const _PaperTradingBanner(),
          Expanded(
            child: state.loadingThread
                ? const Center(
                    child: CircularProgressIndicator(color: AppColors.primary))
                : state.loadError != null && state.messages.isEmpty
                    ? _LoadErrorView(
                        message: state.loadError!,
                        onRetry: () => ref.read(renoProvider.notifier).loadThread(),
                      )
                    : state.messages.isEmpty
                        ? const _EmptyState()
                        : ListView.builder(
                            controller: _scrollController,
                            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                            itemCount: state.messages.length + (state.sending ? 1 : 0),
                            itemBuilder: (context, i) {
                              if (i >= state.messages.length) {
                                return const _TypingIndicator();
                              }
                              // Bug fix (2026-09-04, overnight continuous-
                              // improvement pass): every past chat message
                              // that ever carried a get_suggestion opportunity
                              // rendered its own live "Approve Trade" button
                              // forever -- tapping an OLD card didn't approve
                              // *that* card's plan (approvePlan() has no
                              // per-message id; it always re-resolves and
                              // opens whatever the server's CURRENT
                              // suggestion is, see conversationService.js's
                              // approvePlan()). A user scrolling back and
                              // tapping a stale card from an earlier
                              // BTCUSDT suggestion could unknowingly open a
                              // trade on a completely different, currently-
                              // live suggestion -- undermining decision #11's
                              // explicit-approval guarantee (approving what
                              // you believe you're approving). Only the most
                              // recent opportunity card in the transcript can
                              // still correspond to "the current suggestion",
                              // so only it stays actionable; older ones are
                              // shown as read-only history instead.
                              final isLatestOpportunity = state.messages[i].opportunity != null &&
                                  i == _lastOpportunityIndex(state.messages);
                              return _MessageBlock(
                                message: state.messages[i],
                                isLatestOpportunity: isLatestOpportunity,
                              );
                            },
                          ),
          ),
          if (state.sendError != null)
            _InlineErrorBanner(message: state.sendError!),
          if (state.approveResultMessage != null)
            _ApproveResultBanner(message: state.approveResultMessage!),
          _InputBar(controller: _inputController, sending: state.sending, onSend: _send),
        ],
      ),
    );
  }
}

// Index of the last message in the transcript that carries an opportunity —
// see the 2026-09-04 bug-fix comment above where this is used. Only that one
// message's Approve button can still correspond to the server's current
// suggestion (approvePlan() has no per-message id and always re-resolves
// "the" current suggestion), so every earlier opportunity card is read-only.
int _lastOpportunityIndex(List<RenoMessage> messages) {
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].opportunity != null) return i;
  }
  return -1;
}

class _PaperTradingBanner extends StatelessWidget {
  const _PaperTradingBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: const Text(
        'Paper trading — practice money only. Nothing RENO does here is real, and nothing opens a trade unless you tap Approve.',
        style: TextStyle(color: AppColors.textMuted, fontSize: 11.5, height: 1.4),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.asset('assets/images/reno-mark.png', width: 56, height: 56),
            ),
            const SizedBox(height: 16),
            const Text('Ask RENO what to trade today',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text(
              'RENO looks across every market it tracks, tells you what it '
              'sees and why, remembers what you approve, and keeps watching '
              'it after that.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

class _LoadErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _LoadErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, color: AppColors.textMuted, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: onRetry,
              style: OutlinedButton.styleFrom(side: const BorderSide(color: AppColors.border)),
              child: const Text('Try again', style: TextStyle(color: AppColors.textPrimary)),
            ),
          ],
        ),
      ),
    );
  }
}

class _TypingIndicator extends StatelessWidget {
  const _TypingIndicator();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: const SizedBox(
              width: 20, height: 14,
              child: Center(
                child: SizedBox(
                  width: 16, height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textMuted),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InlineErrorBanner extends StatelessWidget {
  final String message;
  const _InlineErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppColors.error.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Text(message, style: const TextStyle(color: AppColors.error, fontSize: 13, fontWeight: FontWeight.w600)),
    );
  }
}

class _ApproveResultBanner extends StatelessWidget {
  final String message;
  const _ApproveResultBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: AppColors.success.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Text(message, style: const TextStyle(color: AppColors.success, fontSize: 13, fontWeight: FontWeight.w600)),
    );
  }
}

class _InputBar extends StatelessWidget {
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;
  const _InputBar({required this.controller, required this.sending, required this.onSend});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(12, 8, 12, 8 + MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(
        color: AppColors.background,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              enabled: !sending,
              minLines: 1,
              maxLines: 4,
              maxLength: 2000, // matches backend's own 2000-char cap
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSend(),
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 15),
              decoration: InputDecoration(
                counterText: '',
                hintText: 'Ask RENO…',
                hintStyle: const TextStyle(color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.card,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: const BorderSide(color: AppColors.border),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: sending ? null : onSend,
            icon: sending
                ? const SizedBox(width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.primary))
                : const Icon(Icons.arrow_upward_rounded, color: AppColors.primary),
            style: IconButton.styleFrom(
              backgroundColor: AppColors.card,
              shape: const CircleBorder(),
              padding: const EdgeInsets.all(12),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBlock extends ConsumerWidget {
  final RenoMessage message;
  // See the 2026-09-04 bug-fix comment where this is computed: only the
  // single most recent opportunity card in the whole transcript is still
  // actionable, since approvePlan() always approves whatever the server's
  // CURRENT suggestion is, not "this card's" plan specifically.
  final bool isLatestOpportunity;
  const _MessageBlock({required this.message, this.isLatestOpportunity = false});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isUser = message.isUser;
    final opportunity = message.opportunity;
    final positions = message.openPositions;
    final portfolio = message.portfolioSummary;
    final trackRecord = message.trackRecord;
    final outcomes = message.recentOutcomes;

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (message.proactiveTrigger != null) ...[
            const _ProactiveLabel(),
            const SizedBox(height: 4),
          ],
          Align(
            alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: isUser ? AppColors.primary : AppColors.card,
                borderRadius: BorderRadius.circular(16),
                border: isUser ? null : Border.all(color: AppColors.border),
              ),
              child: Text(
                message.content,
                style: TextStyle(
                  color: isUser ? Colors.white : AppColors.textPrimary,
                  fontSize: 15, height: 1.4,
                ),
              ),
            ),
          ),
          if (opportunity != null) ...[
            const SizedBox(height: 10),
            _OpportunityCard(opportunity: opportunity, isActionable: isLatestOpportunity),
          ],
          if (positions != null) ...[
            const SizedBox(height: 10),
            ...positions.map((p) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _PositionCard(position: p),
                )),
          ],
          if (portfolio != null) ...[
            const SizedBox(height: 10),
            _StatsCard(title: 'Portfolio', stats: portfolio),
          ],
          if (trackRecord != null) ...[
            const SizedBox(height: 10),
            _StatsCard(title: 'Track Record — Paper Trading', stats: trackRecord),
          ],
          if (outcomes != null) ...[
            const SizedBox(height: 10),
            _RecentOutcomesCard(outcomes: outcomes),
          ],
        ],
      ),
    );
  }
}

class _ProactiveLabel extends StatelessWidget {
  const _ProactiveLabel();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: const [
        Icon(Icons.notifications_active_outlined, size: 13, color: AppColors.textMuted),
        SizedBox(width: 4),
        Text('RENO checked in on its own',
            style: TextStyle(color: AppColors.textMuted, fontSize: 11, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

// A real opportunity from get_suggestion, with an explicit Approve button
// that calls the dedicated backend endpoint. Never shows a field the
// backend didn't return -- entry/stop/target/timeframe/confidence are all
// individually nullable and each rendered as "not set"/omitted rather than
// guessed. This is the ONLY UI element in the whole RENO screen that can
// open a (paper) trade.
class _OpportunityCard extends ConsumerWidget {
  final RenoOpportunity opportunity;
  // False for every opportunity card except the most recent one in the
  // transcript — see the 2026-09-04 bug-fix comment in _RenoScreenState's
  // build() where this is computed. A stale card can no longer be approved
  // from here: approvePlan() has no per-message id, so tapping it would
  // silently approve whatever the server's CURRENT suggestion is instead of
  // the plan actually shown on this older card.
  final bool isActionable;
  const _OpportunityCard({required this.opportunity, this.isActionable = true});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(renoProvider);
    final isAvoid = opportunity.decision == 'AVOID';
    final isBuy = opportunity.action == 'BUY';
    final actionColor = isAvoid ? AppColors.warning : (isBuy ? AppColors.buy : AppColors.sell);

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isActionable ? AppColors.border : AppColors.border.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(color: actionColor, borderRadius: BorderRadius.circular(7)),
                child: Text(
                  isAvoid ? '${opportunity.action} · FLAGGED' : opportunity.action,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 12),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(opportunity.displayName,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          if (opportunity.isOlderSignal) ...[
            const SizedBox(height: 8),
            const _StaleDataNote(text: 'Using a slightly older signal than usual — still within a trustworthy window, just not brand new.'),
          ],
          const SizedBox(height: 12),
          _FieldRow(label: 'Entry', value: opportunity.entryPrice?.toString()),
          _FieldRow(label: 'Stop loss', value: opportunity.stopLoss?.toString()),
          _FieldRow(label: 'Take profit', value: opportunity.takeProfit?.toString()),
          _FieldRow(label: 'Timeframe', value: opportunity.timeframe),
          // Bug fix (UI/backend audit): backend confidence values are
          // already 0-100 (see conversationService/brainController -- e.g.
          // "with 83% confidence"), not a 0-1 fraction. Multiplying by 100
          // again turned a real 82% into "8200%" in the chat UI.
          _FieldRow(label: 'Confidence',
              value: opportunity.confidence != null ? '${opportunity.confidence!.toStringAsFixed(0)}%' : null),
          if (opportunity.why.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Text('Why', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            ...opportunity.why.map((line) => Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Text(line, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13.5, height: 1.4)),
                )),
          ],
          const SizedBox(height: 14),
          if (isActionable) ...[
            SizedBox(
              width: double.infinity,
              height: 46,
              child: ElevatedButton(
                onPressed: state.approving ? null : () {
                  HapticFeedback.mediumImpact();
                  // Pass this exact card's asset/action through so the backend
                  // can confirm the plan hasn't changed since it was shown
                  // (2026-09-04 fix -- see reno_provider.dart's approvePlan()).
                  ref.read(renoProvider.notifier).approvePlan(
                    asset: opportunity.asset,
                    action: opportunity.action,
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: isAvoid ? AppColors.warning : AppColors.primary,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: state.approving
                    ? const SizedBox(width: 20, height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : const Text('Approve Trade', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Tapping Approve opens a paper trade using this exact plan — the '
              'server re-checks the numbers itself before opening it.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 11, height: 1.4),
            ),
          ] else ...[
            // Bug fix (2026-09-04): this card is no longer the latest
            // opportunity in the transcript, so it's shown as read-only
            // history instead of a live, tappable button — see the
            // 2026-09-04 comment on `isActionable` above for why a stale
            // card must never be directly approvable.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.textMuted.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'This suggestion is no longer the latest one — ask RENO for a fresh '
                'check before approving anything.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 12, height: 1.4, fontStyle: FontStyle.italic),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PositionCard extends StatelessWidget {
  final RenoPosition position;
  const _PositionCard({required this.position});

  @override
  Widget build(BuildContext context) {
    if (position.isHalted) {
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.warning, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text('${position.asset}: ${position.why.isNotEmpty ? position.why.first : "price unavailable right now"}',
                  style: const TextStyle(color: AppColors.warning, fontSize: 13, fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      );
    }

    final isSell = position.recommendation == 'SELL';
    final pnl = position.pnlPct;
    final pnlColor = (pnl ?? 0) >= 0 ? AppColors.success : AppColors.error;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isSell ? AppColors.error.withValues(alpha: 0.4) : AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(position.asset,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
              const SizedBox(width: 8),
              if (pnl != null)
                Text('${pnl >= 0 ? '+' : ''}${pnl.toStringAsFixed(2)}% (paper, unrealized)',
                    style: TextStyle(color: pnlColor, fontSize: 12, fontWeight: FontWeight.w600)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isSell ? AppColors.error : AppColors.success,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(position.recommendation,
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          if (position.why.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(position.why.first,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5, height: 1.4)),
          ],
        ],
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  final String title;
  final Map<String, dynamic> stats;
  const _StatsCard({required this.title, required this.stats});

  // Only renders scalar (number/string/bool) top-level keys -- nested
  // objects/arrays (e.g. a per-asset breakdown array) are skipped here
  // rather than mis-rendered; a future pass with real Flutter tooling can
  // add a dedicated breakdown table once this compiles and someone can see
  // the real response shape on-device.
  @override
  Widget build(BuildContext context) {
    final rows = stats.entries.where((e) => e.value is num || e.value is String || e.value is bool).toList();
    if (rows.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ...rows.map((e) => _FieldRow(label: _labelFor(e.key), value: e.value.toString())),
        ],
      ),
    );
  }

  String _labelFor(String key) {
    // camelCase -> "Camel Case", good enough for real backend field names
    // like totalPnl / winRate without a hand-maintained label map.
    final spaced = key.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m.group(1)}');
    return spaced[0].toUpperCase() + spaced.substring(1);
  }
}

class _RecentOutcomesCard extends StatelessWidget {
  final List<Map<String, dynamic>> outcomes;
  const _RecentOutcomesCard({required this.outcomes});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Recent Closed Trades — Actual P&L',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ...outcomes.take(10).map((t) {
            final pnl = (t['pnl'] as num?)?.toDouble();
            final pnlPct = (t['pnlPct'] as num?)?.toDouble();
            final win = t['result'] == 'win';
            final color = pnl == null ? AppColors.textMuted : (win ? AppColors.success : AppColors.error);
            final pnlText = pnl != null
                ? '${pnl >= 0 ? '+' : ''}\$${pnl.toStringAsFixed(2)}${pnlPct != null ? ' (${pnlPct >= 0 ? '+' : ''}${pnlPct.toStringAsFixed(1)}%)' : ''}'
                : 'no P&L on record';
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text('${t['asset'] ?? '?'} ${t['direction'] ?? ''}',
                        style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
                  ),
                  Text(pnlText, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w600)),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _FieldRow extends StatelessWidget {
  final String label;
  final String? value;
  const _FieldRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
          ),
          Expanded(
            child: Text(
              value ?? 'Not set',
              style: TextStyle(
                color: value != null ? AppColors.textPrimary : AppColors.textMuted,
                fontSize: 13,
                fontWeight: FontWeight.w600,
                fontStyle: value != null ? FontStyle.normal : FontStyle.italic,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StaleDataNote extends StatelessWidget {
  final String text;
  const _StaleDataNote({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.schedule, size: 14, color: AppColors.warning),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text, style: const TextStyle(color: AppColors.warning, fontSize: 11.5, height: 1.4)),
          ),
        ],
      ),
    );
  }
}
