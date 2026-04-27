@echo off
setlocal enabledelayedexpansion
cd /d "C:\Users\Karwan Store\ai-trading-system\mobile"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "FLUTTER_HOME=C:\Users\Karwan Store\flutter"
set "DART_SDK_BIN=!FLUTTER_HOME!\bin\cache\dart-sdk\bin"
REM Prepend our bin directory to PATH so dart.bat is used first
set "PATH=C:\Users\Karwan Store\ai-trading-system\bin;!DART_SDK_BIN!;!JAVA_HOME!\bin;!FLUTTER_HOME!\bin;%PATH%"

echo Cleaning...
call flutter clean

echo Getting dependencies...
call flutter pub get

echo Building and running on device...
call flutter run -d RFCX40491RP

