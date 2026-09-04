import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';
import '../models/allocation_proposal_model.dart';

// Master-plan decisions #11 + #14: the AI-worker-cycle flow. Unlike
// GuideNotifier's single yes/no suggestion, this is a "here's what I found,
// here's 2-4 ways to act on it" card -- approving picks exactly one option;
// every other candidate this cycle produced is implicitly declined
// server-side. Nothing here ever opens a trade without an explicit tap.
class AllocationProposalState {
  final bool loading;
  final bool approving; // in-flight for either approve() or reject()
  final AllocationProposalModel? proposal;
  final String? selectedOptionKey;
  final String? error;
  final String? lastResultMessage; // shown briefly after approve/reject

  const AllocationProposalState({
    this.loading = false,
    this.approving = false,
    this.proposal,
    this.selectedOptionKey,
    this.error,
    this.lastResultMessage,
  });

  AllocationProposalState copyWith({
    bool? loading,
    bool? approving,
    String? selectedOptionKey,
    String? error,
    String? lastResultMessage,
  }) => AllocationProposalState(
    loading:   loading   ?? this.loading,
    approving: approving ?? this.approving,
    proposal:  proposal,
    selectedOptionKey: selectedOptionKey ?? this.selectedOptionKey,
    error: error,
    lastResultMessage: lastResultMessage,
  );
}

class AllocationProposalNotifier extends StateNotifier<AllocationProposalState> {
  Timer? _autoRefreshTimer;

  AllocationProposalNotifier() : super(const AllocationProposalState()) {
    fetch();
    // Re-check every minute so a fresh proposal from the AI worker's own
    // cycle shows up without the user having to remember to pull-to-refresh
    // -- same cadence as GuideNotifier.
    _autoRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (!state.approving) fetch(silent: true);
    });
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> fetch({bool silent = false}) async {
    if (!silent) {
      state = state.copyWith(loading: true, error: null, lastResultMessage: null);
    }
    try {
      final res = await ApiService.dio.get(ApiConstants.aiBrainPendingProposal);
      final data = res.data as Map<String, dynamic>;
      final raw = data['proposal'] as Map<String, dynamic>?;
      if (raw == null) {
        // Constructed directly (not copyWith) so a stale selectedOptionKey
        // or proposal from a previous cycle can never leak through once
        // there's genuinely nothing pending.
        state = const AllocationProposalState(loading: false);
      } else {
        final proposal = AllocationProposalModel.fromJson(raw);
        String? defaultKey;
        if (proposal.options.isNotEmpty) {
          final recommended = proposal.options.where((o) => o.isRecommended);
          defaultKey = recommended.isNotEmpty ? recommended.first.key : proposal.options.first.key;
        }
        // Also constructed directly, for the same reason -- a leftover
        // selection from the previous proposal must never silently apply
        // to a new one whose options have different keys.
        state = AllocationProposalState(
          loading: false,
          proposal: proposal,
          selectedOptionKey: defaultKey,
        );
      }
    } on DioException catch (_) {
      if (!silent) {
        state = state.copyWith(loading: false, error: "Couldn't reach the AI — check your connection and try again.");
      }
    }
  }

  void selectOption(String key) {
    state = state.copyWith(selectedOptionKey: key);
  }

  Future<void> approve() async {
    final proposal = state.proposal;
    final optionKey = state.selectedOptionKey;
    if (proposal == null || optionKey == null || state.approving) return;
    state = state.copyWith(approving: true, error: null);
    try {
      final res = await ApiService.dio.post(
        ApiConstants.aiBrainProposalApprove(proposal.id),
        data: {'optionKey': optionKey},
      );
      final data = res.data as Map<String, dynamic>;
      final tradeCount = (data['trades'] as List?)?.length ?? 0;
      final failureCount = (data['failures'] as List?)?.length ?? 0;
      final message = failureCount > 0
          ? 'Opened $tradeCount trade${tradeCount == 1 ? '' : 's'} — $failureCount could not be opened.'
          : 'Opened $tradeCount trade${tradeCount == 1 ? '' : 's'}.';
      // Show the confirmation on its own for a beat before fetching the
      // next cycle's proposal -- mirrors GuideNotifier.approve()'s fix for
      // the same "did it actually do anything?" problem.
      state = AllocationProposalState(loading: false, lastResultMessage: message);
      await Future.delayed(const Duration(seconds: 2));
      await fetch();
    } on DioException catch (e) {
      final msg = (e.response?.data as Map?)?['message'] as String? ?? "Couldn't complete that — try again.";
      state = state.copyWith(approving: false, error: msg);
    }
  }

  Future<void> reject() async {
    final proposal = state.proposal;
    if (proposal == null || state.approving) return;
    state = state.copyWith(approving: true, error: null);
    try {
      await ApiService.dio.post(ApiConstants.aiBrainProposalReject(proposal.id));
      state = const AllocationProposalState(loading: false, lastResultMessage: 'Skipped this cycle.');
      await Future.delayed(const Duration(seconds: 1));
      await fetch();
    } on DioException catch (e) {
      final msg = (e.response?.data as Map?)?['message'] as String? ?? "Couldn't complete that — try again.";
      state = state.copyWith(approving: false, error: msg);
    }
  }
}

final allocationProposalProvider =
    StateNotifierProvider<AllocationProposalNotifier, AllocationProposalState>(
  (ref) => AllocationProposalNotifier(),
);
