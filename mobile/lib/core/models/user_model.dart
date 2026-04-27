import 'package:equatable/equatable.dart';

class UserPreferences extends Equatable {
  final List<String> assets;
  final int confidenceThreshold;
  final bool notificationsEnabled;
  final bool fcmEnabled;
  final bool telegramEnabled;
  final int maxNotificationsPerHour;

  const UserPreferences({
    this.assets = const ['BTCUSDT', 'ETHUSDT'],
    this.confidenceThreshold = 70,
    this.notificationsEnabled = true,
    this.fcmEnabled = true,
    this.telegramEnabled = false,
    this.maxNotificationsPerHour = 5,
  });

  factory UserPreferences.fromJson(Map<String, dynamic> json) => UserPreferences(
    assets: List<String>.from(json['assets'] ?? []),
    confidenceThreshold: json['confidenceThreshold'] ?? 70,
    notificationsEnabled: json['notificationsEnabled'] ?? true,
    fcmEnabled: json['fcmEnabled'] ?? true,
    telegramEnabled: json['telegramEnabled'] ?? false,
    maxNotificationsPerHour: json['maxNotificationsPerHour'] ?? 5,
  );

  Map<String, dynamic> toJson() => {
    'assets': assets,
    'confidenceThreshold': confidenceThreshold,
    'notificationsEnabled': notificationsEnabled,
    'fcmEnabled': fcmEnabled,
    'telegramEnabled': telegramEnabled,
    'maxNotificationsPerHour': maxNotificationsPerHour,
  };

  UserPreferences copyWith({
    List<String>? assets,
    int? confidenceThreshold,
    bool? notificationsEnabled,
    bool? fcmEnabled,
    bool? telegramEnabled,
    int? maxNotificationsPerHour,
  }) => UserPreferences(
    assets: assets ?? this.assets,
    confidenceThreshold: confidenceThreshold ?? this.confidenceThreshold,
    notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
    fcmEnabled: fcmEnabled ?? this.fcmEnabled,
    telegramEnabled: telegramEnabled ?? this.telegramEnabled,
    maxNotificationsPerHour: maxNotificationsPerHour ?? this.maxNotificationsPerHour,
  );

  @override
  List<Object?> get props => [
    assets, confidenceThreshold, notificationsEnabled,
    fcmEnabled, telegramEnabled, maxNotificationsPerHour,
  ];
}

class UserModel extends Equatable {
  final String id;
  final String name;
  final String email;
  final String role;
  final bool isActive;
  final String? fcmToken;
  final String? telegramChatId;
  final UserPreferences preferences;

  const UserModel({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.isActive = true,
    this.fcmToken,
    this.telegramChatId,
    this.preferences = const UserPreferences(),
  });

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
    id: json['_id'] ?? '',
    name: json['name'] ?? '',
    email: json['email'] ?? '',
    role: json['role'] ?? 'user',
    isActive: json['isActive'] ?? true,
    fcmToken: json['fcmToken'],
    telegramChatId: json['telegramChatId'],
    preferences: json['preferences'] != null
        ? UserPreferences.fromJson(json['preferences'])
        : const UserPreferences(),
  );

  bool get isAdmin   => role == 'admin';
  bool get isPremium => role == 'premium' || role == 'admin';

  @override
  List<Object?> get props => [id, name, email, role, isActive, preferences];
}
