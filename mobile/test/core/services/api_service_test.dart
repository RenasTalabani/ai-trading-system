import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_trading_app/core/services/api_service.dart';

RequestOptions _opts() => RequestOptions(path: '/test');

void main() {
  group('DioErrorMessage.userMessage', () {
    test('prefers the backend-provided message field when the response body is a Map', () {
      final err = DioException(
        requestOptions: _opts(),
        response: Response(
          requestOptions: _opts(),
          statusCode: 400,
          data: {'success': false, 'message': 'targetPrice must be a positive number'},
        ),
        type: DioExceptionType.badResponse,
      );
      expect(err.userMessage, 'targetPrice must be a positive number');
    });

    test('falls back to a generic message when the response Map has no message field', () {
      final err = DioException(
        requestOptions: _opts(),
        response: Response(requestOptions: _opts(), statusCode: 500, data: {'success': false}),
        type: DioExceptionType.badResponse,
      );
      expect(err.userMessage, 'Something went wrong');
    });

    test('gives a specific message for a connection timeout with no response body', () {
      final err = DioException(requestOptions: _opts(), type: DioExceptionType.connectionTimeout);
      expect(err.userMessage, 'Connection timed out. Check your network.');
    });

    test('gives a specific message for a receive timeout with no response body', () {
      final err = DioException(requestOptions: _opts(), type: DioExceptionType.receiveTimeout);
      expect(err.userMessage, 'Connection timed out. Check your network.');
    });

    test('gives a specific message for a connection error (e.g. offline) with no response body', () {
      final err = DioException(requestOptions: _opts(), type: DioExceptionType.connectionError);
      expect(err.userMessage, 'Cannot reach the server. Check your connection.');
    });

    test('falls back to the raw DioException message for other error types with no response', () {
      final err = DioException(
        requestOptions: _opts(),
        type: DioExceptionType.cancel,
        message: 'Request was cancelled',
      );
      expect(err.userMessage, 'Request was cancelled');
    });

    test('falls back to the generic message when there is no response AND no message', () {
      final err = DioException(requestOptions: _opts(), type: DioExceptionType.unknown);
      expect(err.userMessage, 'Something went wrong');
    });

    test('does not crash when response.data is a non-Map, non-null value (e.g. a raw string)', () {
      final err = DioException(
        requestOptions: _opts(),
        response: Response(requestOptions: _opts(), statusCode: 502, data: '<html>Bad Gateway</html>'),
        type: DioExceptionType.badResponse,
      );
      // response.data is not a Map, so this should fall through past the
      // Map-specific branch rather than throwing on `response.data['message']`.
      expect(() => err.userMessage, returnsNormally);
    });
  });
}
