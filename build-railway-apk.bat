@echo off
echo Building AI Trading APK for Railway cloud...
set PUB_CACHE=C:\PubCache

REM Fix local.properties to use C:\flutter (no spaces)
echo sdk.dir=C:\\AndroidSDK> mobile\android\local.properties
echo flutter.sdk=C:\\flutter>> mobile\android\local.properties
echo flutter.buildMode=release>> mobile\android\local.properties
echo flutter.versionName=1.0.0>> mobile\android\local.properties
echo flutter.versionCode=1>> mobile\android\local.properties

REM T-077 (2026-08-30): distinguished-empathy-production-5d79 was the OLD
REM backend Railway service, deleted and recreated from scratch tonight --
REM it no longer exists (confirmed: returns 404 "Application not found").
REM New backend domain: backend-production-bd777.up.railway.app. WS_URL
REM points at the backend too (not ai-service) -- the WebSocket server
REM lives on the Node backend at path /ws (see backend/src/websocket/
REM wsServer.js), same as it always has.
cd mobile
flutter build apk --release --no-pub ^
  --dart-define=API_BASE_URL=https://backend-production-bd777.up.railway.app ^
  --dart-define=WS_URL=wss://backend-production-bd777.up.railway.app/ws

if %ERRORLEVEL% EQU 0 (
  echo.
  echo BUILD SUCCESSFUL!
  copy build\app\outputs\flutter-apk\app-release.apk ..\AiTrading-Railway.apk
  echo APK saved to: ai-trading-system\AiTrading-Railway.apk
) else (
  echo BUILD FAILED - check errors above
)
cd ..
