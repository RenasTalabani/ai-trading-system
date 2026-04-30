import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StorageService {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _keyToken = 'auth_token';
  static const _keyUser  = 'auth_user';

  static Future<void> saveToken(String token) =>
      _storage.write(key: _keyToken, value: token);

  static Future<String?> getToken() => _storage.read(key: _keyToken);

  static Future<void> saveUser(String userJson) =>
      _storage.write(key: _keyUser, value: userJson);

  static Future<String?> getUser() => _storage.read(key: _keyUser);

  static Future<void> clear() => _storage.deleteAll();

  static const _keyBudget = 'ai_brain_budget';

  static Future<void> saveBudget(double v) =>
      _storage.write(key: _keyBudget, value: v.toString());

  static Future<double> getBudget() async {
    final v = await _storage.read(key: _keyBudget);
    return v != null ? double.tryParse(v) ?? 500.0 : 500.0;
  }
}
