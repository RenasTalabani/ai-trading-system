// RENO Phase 3, steps 4-6 (2026-09-01) — Riverpod state for the mobile RENO
// chat screen. Mirrors guide_provider.dart's StateNotifier + Dio pattern.
//
// PREPARED, NOT VERIFIED — see reno_message_model.dart's header for why
// (no Flutter/Dart toolchain reachable in the environment that wrote this).
// Written by reading the real backend routes/controllers/service directly
// (conversation.js, conversationController.js, conversationService.js)
// before writing this file, so the endpoints, payload shapes, and error
// paths below match what the backend genuinely sends today -- but it has
// not been compiled or run.
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';
import '../models/reno_message_model.dart';

class RenoState {
  final bool loadingThread; // initial GET /conversation
  final bool sending;       // a message is in flight
  final bool approving;     // an approve tap is in flight
  final List<RenoMessage> messages; // oldest first
  final String? loadError;
  final String? sendError;
  final String? approveResultMessage; // shown briefly after a successful approve

  const RenoState({
    this.loadingThread = false,
    this.sending = false,
    this.approving = false,
    this.messages = const [],
    this.loadError,
    this.sendError,
    this.approveResultMessage,
  });

  RenoState copyWith({
    bool? loadingThread,
    bool? sending,
    bool? approving,
    List<RenoMessage>? messages,
    String? loadError,
    String? sendError,
    String? approveResultMessage,
    bool clearErrors = false,
  }) =>
      RenoState(
        loadingThread: loadingThread ?? this.loadingThread,
        sending: sending ?? this.sending,
        approving: approving ?? this.approving,
        messages: messages ?? this.messages,
        loadError: clearErrors ? null : (loadError ?? this.loadError),
        sendError: clearErrors ? null : (sendError ?? this.sendError),
        approveResultMessage: approveResultMessage,
      );
}

class RenoNotifier extends StateNotifier<RenoState> {
  RenoNotifier() : super(const RenoState()) {
    loadThread();
  }

  Future<void> loadThread() async {
    state = state.copyWith(loadingThread: true, clearErrors: true);
    try {
      final res = await ApiService.dio.get(ApiConstants.conversationThread);
      final data = res.data as Map<String, dynamic>;
      final rawMessages = (data['messages'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map((e) => RenoMessage.fromJson(e))
          .toList();
      // Backend returns newest-first (sort createdAt: -1, limit 50) --
      // reverse to oldest-first for a normal top-to-bottom chat view.
      final ordered = rawMessages.reversed.toList();
      state = state.copyWith(loadingThread: false, messages: ordered);
    } on DioException catch (_) {
      state = state.copyWith(
        loadingThread: false,
        loadError: "Couldn't load your conversation with RENO — check your connection and try again.",
      );
    }
  }

  Future<void> sendMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || state.sending) return;

    // Optimistic local echo of the user's own message -- the backend's
    // postMessage response only carries the assistant's reply, never an
    // echo of what was sent, so the UI adds it locally. This is the
    // user's own just-typed text, not a value invented on their behalf.
    final optimisticUser = RenoMessage(
      id: 'local-${DateTime.now().microsecondsSinceEpoch}',
      role: 'user',
      content: trimmed,
      createdAt: DateTime.now(),
      toolCalls: const [],
      relatedTradeIds: const [],
    );
    state = state.copyWith(
      sending: true,
      clearErrors: true,
      messages: [...state.messages, optimisticUser],
    );

    try {
      final res = await ApiService.dio.post(
        ApiConstants.conversationMessage,
        data: {'text': trimmed},
      );
      final data = res.data as Map<String, dynamic>;
      final reply = data['reply'] as Map<String, dynamic>?;
      if (reply != null) {
        state = state.copyWith(
          sending: false,
          messages: [...state.messages, RenoMessage.fromJson(reply)],
        );
      } else {
        state = state.copyWith(sending: false);
      }
    } on DioException catch (e) {
      final msg = (e.response?.data as Map?)?['message'] as String? ??
          "Couldn't send that to RENO — try again in a moment.";
      state = state.copyWith(sending: false, sendError: msg);
    }
  }

  // Dedicated approval action -- calls the dedicated backend endpoint with
  // NO trade parameters (T-071 parity: the server re-resolves the
  // suggestion itself and never trusts anything the client sends). This is
  // the ONLY path that can open a real (paper) trade from RENO chat --
  // ordinary chat text, including something like "yes" typed into the
  // message box, is never interpreted as approval anywhere in this app.
  Future<void> approvePlan() async {
    if (state.approving) return;
    state = state.copyWith(approving: true, clearErrors: true);
    try {
      final res = await ApiService.dio.post(ApiConstants.conversationApprove);
      final data = res.data as Map<String, dynamic>;
      // Bug fix (UI/backend audit): the backend's `reply` field is a full
      // ConversationMessage object (see conversationController.approvePlan /
      // conversationService.approvePlan), not a plain string. Casting it
      // directly to String threw an uncaught TypeError on every single
      // "Approve" tap -- and because it's a TypeError rather than a
      // DioException, the catch block below never even saw it. Parse it as
      // a RenoMessage and read its `content` instead.
      final replyMsg = data['reply'] is Map<String, dynamic>
          ? RenoMessage.fromJson(data['reply'] as Map<String, dynamic>)
          : null;
      state = state.copyWith(
        approving: false,
        approveResultMessage: replyMsg?.content ?? 'Trade approved.',
      );
      // Refresh the thread so the real assistant confirmation message
      // (and any thesis/state it references) shows up in the transcript
      // exactly as the backend recorded it, rather than being reconstructed
      // client-side.
      await loadThread();
    } on DioException catch (e) {
      final body = e.response?.data as Map?;
      final msg = body?['message'] as String? ?? "Couldn't approve that trade right now.";
      state = state.copyWith(approving: false, sendError: msg);
    }
  }
}

final renoProvider = StateNotifierProvider<RenoNotifier, RenoState>((ref) => RenoNotifier());
