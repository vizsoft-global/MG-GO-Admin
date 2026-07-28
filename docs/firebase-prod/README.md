# Firebase — production environment

Populated after the first Pulumi `production` stack deploy.

1. Note `firebaseAndroidAppId` / `firebaseIosAppId` / `firebaseWebAppId` from `pulumi stack output`.
2. Regenerate config files:

```bash
firebase apps:sdkconfig ANDROID <android_app_id> \
  -o docs/firebase-prod/google-services.json \
  --project musallam-delivery-prod

firebase apps:sdkconfig IOS <ios_app_id> \
  -o docs/firebase-prod/GoogleService-Info.plist \
  --project musallam-delivery-prod
```

3. Update `docs/DRIVER_APP_HANDOFF.md` §1a and §7 with the new app IDs.
