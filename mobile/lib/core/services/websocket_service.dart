import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../constants/api_constants.dart';
import 'storage_service.dart';

enum WsStatus { disconnected, connecting, connected, error }

class WsMessage {
  final String type;
  final Map<String, dynamic> data;
  WsMessage(this.type, this.data);
}

class WebSocketService {
  WebSocketService._();
  static final instance = WebSocketService._();

  WebSocketChannel? _channel;
  StreamController<WsMessage>? _controller;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  WsStatus _status = WsStatus.disconnected;
  bool _shouldReconnect = true;

  Stream<WsMessage> get stream => _controller!.stream;
  WsStatus get status => _status;

  Future<void> connect() async {
    if (_status == WsStatus.connected || _status == WsStatus.connecting) return;

    _controller ??= StreamController<WsMessage>.broadcast();
    _status = WsStatus.connecting;
    _shouldReconnect = true;

    final token = await StorageService.getToken();
    if (token == null) return;

    try {
      final uri = Uri.parse('${ApiConstants.wsUrl}?token=$token');
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;

      _status = WsStatus.connected;
      _startHeartbeat();

      _channel!.stream.listen(
        _onData,
        onError: (_) => _onDisconnect(),
        onDone:  () => _onDisconnect(),
        cancelOnError: false,
      );
    } catch (_) {
      _status = WsStatus.error;
      _scheduleReconnect();
    }
  }

  void _onData(dynamic raw) {
    try {
      final json = jsonDecode(raw as String) as Map<String, dynamic>;
      final type = json['type'] as String? ?? 'unknown';
      final data = (json['data'] ?? json) as Map<String, dynamic>;
      _controller?.add(WsMessage(type, data));
    } catch (_) {}
  }

  void _onDisconnect() {
    _status = WsStatus.disconnected;
    _heartbeatTimer?.cancel();
    if (_shouldReconnect) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), connect);
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      try {
        _channel?.sink.add(jsonEncode({'type': 'ping'}));
      } catch (_) {}
    });
  }

  void disconnect() {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _heartbeatTimer?.cancel();
    _channel?.sink.close();
    _status = WsStatus.disconnected;
  }

  void dispose() {
    disconnect();
    _controller?.close();
    _controller = null;
  }
}
