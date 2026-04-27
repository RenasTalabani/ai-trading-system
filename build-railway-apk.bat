@echo off
echo Building AI Trading APK for Railway cloud...
set PUB_CACHE=C:\PubCache

REM Fix local.properties to use C:\flutter (no spaces)
echo sdk.dir=C:\\AndroidSDK> mobile\android\local.properties
echo flutter.sdk=C:\\flutter>> mobile\android\local.properties
echo flutter.buildMode=release>> mobile\android\local.properties
echo flutter.versionName=1.0.0>> mobile\android\local.properties
echo flutter.versionCode=1>> mobile\android\local.properties

cd mobile
flutter build apk --release --no-pub ^
  --dart-define=API_BASE_URL=https://distinguished-empathy-production-5d79.up.railway.app ^
  --dart-define=WS_URL=wss://distinguished-empathy-production-5d79.up.railway.app/ws

if %ERRORLEVEL% EQU 0 (
  echo.
  echo BUILD SUCCESSFUL!
  copy build\app\outputs\flutter-apk\app-release.apk ..\AiTrading-Railway.apk
  echo APK saved to: ai-trading-system\AiTrading-Railway.apk
) else (
  echo BUILD FAILED - check errors above
)
cd ..
