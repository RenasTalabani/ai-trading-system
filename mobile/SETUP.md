# Flutter Mobile App — Setup

## Prerequisites
- Flutter SDK ≥ 3.22
- Android Studio / Xcode
- Firebase project (for push notifications)

## Firebase Setup (required for FCM)
1. Create a Firebase project at console.firebase.google.com
2. Add an Android app with package `com.aitrader.app`
3. Download `google-services.json` → place at `android/app/google-services.json`
4. Add `google_services` plugin to `android/app/build.gradle` (see Flutter Firebase docs)

## Environment
By default the app connects to `http://10.0.2.2:5000` (Android emulator → localhost).

To override, set build arguments:
```
flutter run --dart-define=API_BASE_URL=http://YOUR_IP:5000 --dart-define=WS_URL=ws://YOUR_IP:5000/ws
```

For physical device, replace with your machine's local IP address.

## Run
```bash
cd mobile
flutter pub get
flutter run
```

## Build (release)
```bash
flutter build apk --release --dart-define=API_BASE_URL=https://your-backend.com
```
