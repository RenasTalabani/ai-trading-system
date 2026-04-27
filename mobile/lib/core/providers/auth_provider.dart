import 'dart:convert';
import 'dart:math';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../models/user_model.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../constants/api_constants.dart';

class AuthState {
  final UserModel? user;
  final String? token;
  final bool loading;
  final String? error;
  final bool isGuest;

  const AuthState({
    this.user,
    this.token,
    this.loading = false,
    this.error,
    this.isGuest = false,
  });

  bool get isAuthenticated => (token != null && user != null) || isGuest;

  AuthState copyWith({
    UserModel? user,
    String? token,
    bool? loading,
    String? error,
    bool? isGuest,
  }) => AuthState(
    user:    user    ?? this.user,
    token:   token   ?? this.token,
    loading: loading ?? this.loading,
    error:   error,
    isGuest: isGuest ?? this.isGuest,
  );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState()) {
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final token    = await StorageService.getToken();
    final userJson = await StorageService.getUser();
    if (token != null && userJson != null) {
      try {
        final user = UserModel.fromJson(jsonDecode(userJson));
        state = AuthState(user: user, token: token);
      } catch (_) {
        await StorageService.clear();
      }
    }
  }

  Future<String?> login(String email, String password) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final resp = await ApiService.dio.post(ApiConstants.login, data: {
        'email': email, 'password': password,
      });
      final token = resp.data['token'] as String;
      final user  = UserModel.fromJson(resp.data['user']);
      await StorageService.saveToken(token);
      await StorageService.saveUser(jsonEncode(resp.data['user']));
      state = AuthState(user: user, token: token);
      return null;
    } on DioException catch (e) {
      final msg = e.userMessage;
      state = state.copyWith(loading: false, error: msg);
      return msg;
    }
  }

  Future<String?> register(String name, String email, String password) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final resp = await ApiService.dio.post(ApiConstants.register, data: {
        'name': name, 'email': email, 'password': password,
      });
      final token = resp.data['token'] as String;
      final user  = UserModel.fromJson(resp.data['user']);
      await StorageService.saveToken(token);
      await StorageService.saveUser(jsonEncode(resp.data['user']));
      state = AuthState(user: user, token: token);
      return null;
    } on DioException catch (e) {
      final msg = e.userMessage;
      state = state.copyWith(loading: false, error: msg);
      return msg;
    }
  }

  Future<void> loginAsGuest() async {
    state = state.copyWith(loading: true, error: null);

    // Try to auto-register an anonymous account so all API features work
    final ts = DateTime.now().millisecondsSinceEpoch;
    final rnd = _randomSuffix(6);
    final email    = 'guest_${ts}_$rnd@trader.app';
    final password = _randomSuffix(16);
    const name     = 'Guest';

    try {
      final resp = await ApiService.dio.post(ApiConstants.register, data: {
        'name': name, 'email': email, 'password': password,
      }).timeout(const Duration(seconds: 8));

      final token = resp.data['token'] as String;
      final user  = UserModel.fromJson(resp.data['user']);
      await StorageService.saveToken(token);
      await StorageService.saveUser(jsonEncode(resp.data['user']));
      // Mark as guest so UI can adapt (hide account-specific features)
      state = AuthState(user: user, token: token, isGuest: true);
    } catch (_) {
      // Offline fallback — local-only guest, signals won't load but app opens
      state = const AuthState(user: UserModel(id:'guest',name:'Guest',email:'guest@local',role:'user'), isGuest: true);
    }
  }

  Future<void> logout() async {
    await StorageService.clear();
    state = const AuthState();
  }

  Future<void> updatePreferences(Map<String, dynamic> prefs) async {
    if (state.isGuest) return; // guests: no server-side prefs
    try {
      final resp = await ApiService.dio.patch(ApiConstants.preferences, data: prefs);
      final updated = UserModel.fromJson({
        ...state.user!.toPartialJson(),
        'preferences': resp.data['preferences'],
      });
      await StorageService.saveUser(jsonEncode({
        ...state.user!.toPartialJson(),
        'preferences': resp.data['preferences'],
      }));
      state = state.copyWith(user: updated);
    } on DioException catch (_) {}
  }

  static String _randomSuffix(int len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final rng = Random.secure();
    return List.generate(len, (_) => chars[rng.nextInt(chars.length)]).join();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(
  (_) => AuthNotifier(),
);

extension UserModelJson on UserModel {
  Map<String, dynamic> toPartialJson() => {
    '_id': id, 'name': name, 'email': email, 'role': role,
    'isActive': isActive, 'preferences': preferences.toJson(),
  };
}
