import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../models/notification_model.dart';
import '../services/api_service.dart';
import '../constants/api_constants.dart';

class NotificationsState {
  final List<NotificationModel> items;
  final int unreadCount;
  final bool loading;
  final String? error;

  const NotificationsState({
    this.items       = const [],
    this.unreadCount = 0,
    this.loading     = false,
    this.error,
  });

  NotificationsState copyWith({
    List<NotificationModel>? items,
    int? unreadCount,
    bool? loading,
    String? error,
  }) => NotificationsState(
    items:       items       ?? this.items,
    unreadCount: unreadCount ?? this.unreadCount,
    loading:     loading     ?? this.loading,
    error:       error,
  );
}

class NotificationsNotifier extends StateNotifier<NotificationsState> {
  NotificationsNotifier() : super(const NotificationsState()) {
    fetch();
  }

  Future<void> fetch() async {
    state = state.copyWith(loading: state.items.isEmpty);
    try {
      final results = await Future.wait([
        ApiService.dio.get(ApiConstants.notifications, queryParameters: {'limit': 50}),
        ApiService.dio.get(ApiConstants.unreadCount),
      ]);
      final list = (results[0].data['data'] as List)
          .map((j) => NotificationModel.fromJson(j))
          .toList();
      final count = results[1].data['unreadCount'] as int? ?? 0;
      state = state.copyWith(items: list, unreadCount: count, loading: false);
    } on DioException catch (e) {
      state = state.copyWith(loading: false, error: e.userMessage);
    }
  }

  Future<void> markRead(String id) async {
    try {
      await ApiService.dio.patch('${ApiConstants.notifications}/$id/read');
      final updated = state.items.map((n) {
        return n.id == id ? NotificationModel.fromJson({
          '_id': n.id, 'type': n.type, 'title': n.title, 'body': n.body,
          'data': const {}, 'createdAt': n.createdAt.toIso8601String(),
          'readAt': DateTime.now().toIso8601String(),
        }) : n;
      }).toList();
      final unread = updated.where((n) => !n.isRead).length;
      state = state.copyWith(items: updated, unreadCount: unread);
    } on DioException catch (_) {}
  }

  Future<void> markAllRead() async {
    try {
      await ApiService.dio.patch(ApiConstants.markAllRead);
      final updated = state.items.map((n) {
        if (n.isRead) return n;
        return NotificationModel.fromJson({
          '_id': n.id, 'type': n.type, 'title': n.title, 'body': n.body,
          'data': const {}, 'createdAt': n.createdAt.toIso8601String(),
          'readAt': DateTime.now().toIso8601String(),
        });
      }).toList();
      state = state.copyWith(items: updated, unreadCount: 0);
    } on DioException catch (_) {}
  }

  Future<void> delete(String id) async {
    try {
      await ApiService.dio.delete('${ApiConstants.notifications}/$id');
      final updated = state.items.where((n) => n.id != id).toList();
      final unread  = updated.where((n) => !n.isRead).length;
      state = state.copyWith(items: updated, unreadCount: unread);
    } on DioException catch (_) {}
  }
}

final notificationsProvider = StateNotifierProvider<NotificationsNotifier, NotificationsState>(
  (_) => NotificationsNotifier(),
);
