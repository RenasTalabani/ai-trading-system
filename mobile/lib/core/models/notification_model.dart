import 'package:equatable/equatable.dart';

class NotificationData extends Equatable {
  final String? signalId;
  final String? asset;
  final String? action;
  final double? confidence;
  final double? price;

  const NotificationData({this.signalId, this.asset, this.action, this.confidence, this.price});

  factory NotificationData.fromJson(Map<String, dynamic> json) => NotificationData(
    signalId:   json['signalId'],
    asset:      json['asset'],
    action:     json['action'],
    confidence: json['confidence'] != null ? (json['confidence']).toDouble() : null,
    price:      json['price'] != null ? (json['price']).toDouble() : null,
  );

  @override
  List<Object?> get props => [signalId, asset, action];
}

class NotificationModel extends Equatable {
  final String id;
  final String type;
  final String title;
  final String body;
  final NotificationData data;
  final int successCount;
  final int failureCount;
  final DateTime? readAt;
  final DateTime createdAt;

  const NotificationModel({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.data,
    this.successCount = 0,
    this.failureCount = 0,
    this.readAt,
    required this.createdAt,
  });

  factory NotificationModel.fromJson(Map<String, dynamic> json) => NotificationModel(
    id:           json['_id'] ?? '',
    type:         json['type'] ?? 'signal',
    title:        json['title'] ?? '',
    body:         json['body'] ?? '',
    data:         NotificationData.fromJson(json['data'] ?? {}),
    successCount: json['successCount'] ?? 0,
    failureCount: json['failureCount'] ?? 0,
    readAt:       json['readAt'] != null ? DateTime.tryParse(json['readAt']) : null,
    createdAt:    DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
  );

  bool get isRead => readAt != null;

  bool get isSignal => type == 'signal';

  @override
  List<Object?> get props => [id, type, title, readAt, createdAt];
}
