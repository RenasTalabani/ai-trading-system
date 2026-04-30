import 'package:dio/dio.dart';
import '../constants/api_constants.dart';
import 'storage_service.dart';

class ApiService {
  static final _dio = Dio(BaseOptions(
    baseUrl:        '${ApiConstants.apiV1}/',
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 90),
    headers: {'Content-Type': 'application/json'},
  ))
    ..interceptors.add(_AuthInterceptor())
    ..interceptors.add(_RetryInterceptor());

  static Dio get dio => _dio;

  // Use for slow endpoints (strategy/simulate can take 60s+)
  static final Options slowOptions = Options(
    receiveTimeout: const Duration(seconds: 120),
    sendTimeout:    const Duration(seconds: 30),
  );
}

class _AuthInterceptor extends Interceptor {
  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await StorageService.getToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // Normalize error message
    final response = err.response;
    if (response != null) {
      final msg = response.data is Map
          ? (response.data['message'] ?? err.message)
          : err.message;
      handler.next(DioException(
        requestOptions: err.requestOptions,
        response: response,
        type: err.type,
        error: msg,
        message: msg?.toString(),
      ));
    } else {
      handler.next(err);
    }
  }
}

class _RetryInterceptor extends Interceptor {
  static const _maxRetries = 2;

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final retries = (err.requestOptions.extra['_retries'] as int?) ?? 0;
    final isNetworkError = err.type == DioExceptionType.connectionError ||
        err.type == DioExceptionType.connectionTimeout;

    if (isNetworkError && retries < _maxRetries) {
      await Future<void>.delayed(Duration(seconds: retries + 1));
      err.requestOptions.extra['_retries'] = retries + 1;
      try {
        final resp = await ApiService.dio.fetch(err.requestOptions);
        handler.resolve(resp);
        return;
      } catch (_) {}
    }
    handler.next(err);
  }
}

extension DioErrorMessage on DioException {
  String get userMessage {
    if (response?.data is Map) {
      return response!.data['message']?.toString() ?? 'Something went wrong';
    }
    if (type == DioExceptionType.connectionTimeout ||
        type == DioExceptionType.receiveTimeout) {
      return 'Connection timed out. Check your network.';
    }
    if (type == DioExceptionType.connectionError) {
      return 'Cannot reach the server. Check your connection.';
    }
    return message ?? 'Something went wrong';
  }
}
