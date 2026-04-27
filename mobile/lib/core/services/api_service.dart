import 'package:dio/dio.dart';
import '../constants/api_constants.dart';
import 'storage_service.dart';

class ApiService {
  static final _dio = Dio(BaseOptions(
    baseUrl:        ApiConstants.apiV1,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    headers: {'Content-Type': 'application/json'},
  ))..interceptors.add(_AuthInterceptor());

  static Dio get dio => _dio;
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
