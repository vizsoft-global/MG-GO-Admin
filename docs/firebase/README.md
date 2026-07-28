# Musallam Delivery — Firebase (`musallam-delivery-kw`)

Firebase project **Musallam Delivery** (`musallam-delivery-kw`) is used for driver push (FCM), Analytics, Crashlytics, Performance, and Remote Config.

## Registered apps

| Platform | App ID | Identifier |
|----------|--------|------------|
| Android | `1:942102607123:android:2b709642cb7ab7a48096e6` | `kw.musallam.delivery` |
| iOS | `1:942102607123:ios:442ef4381a6480f48096e6` | `kw.musallam.delivery` |
| Web | `1:942102607123:web:6522f617aca8ff2f8096e6` | — |

## Mobile app setup

1. **Android** — copy `google-services.json` into `android/app/`.
2. **iOS** — copy `GoogleService-Info.plist` into the Xcode project.
3. **Expo / RN bootstrap** — fetch runtime config from admin:
   `GET https://dpdadmin.vercel.app/api/driver-app/firebase-config?platform=android|ios|web`

## Admin backend (Vercel)

Server push uses **Firebase Admin SDK** via:

- `FIREBASE_SERVICE_ACCOUNT_JSON` (preferred), or
- `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`

Public client keys (safe for mobile):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID_ANDROID` / `FIREBASE_APP_ID_IOS` / `FIREBASE_APP_ID_WEB`

**Never commit** `service-account.json` or private keys.

## Config files in this folder

- `google-services.json` — Android (generated from Firebase CLI)
- `GoogleService-Info.plist` — iOS (generated from Firebase CLI)
- `firebase-web.json` — Web SDK snippet reference

Regenerate with:

```bash
firebase apps:sdkconfig ANDROID 1:942102607123:android:2b709642cb7ab7a48096e6 -o docs/firebase/google-services.json --project musallam-delivery-kw
firebase apps:sdkconfig IOS 1:942102607123:ios:442ef4381a6480f48096e6 -o docs/firebase/GoogleService-Info.plist --project musallam-delivery-kw
```
