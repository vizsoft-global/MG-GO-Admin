# Driver app test build — 1.0.7 (build 7)

Test-only builds of the Musallam Delivery driver app, for handing to QA.

| File | Size | Use it for |
|---|---|---|
| `mg-go-driver-1.0.7+7-arm64-release.apk` | 31 MB | **Real phones.** Covers every 64-bit Android device (Android 7.0+). Give testers this one. |
| `mg-go-driver-1.0.7+7-universal-release.apk` | 72 MB | Android emulators and older 32-bit devices. Only needed if the arm64 build refuses to install. |

Built from `vizsoft-global/DPD-userapp` `main` @ `e726d08`.

- Package: `kw.musallam.delivery`
- Version: `1.0.7` (versionCode 7)
- Min Android 7.0 (API 24), targets API 36
- Backend: Supabase `eoksxkdssptgyqyywdju` (production — real driver data)

## Installing

1. Send the `.apk` to the tester (email, Drive, WhatsApp — any file transfer).
2. On the phone, open the file and approve "install from unknown sources" when prompted.
3. Sign in with a driver code and 6-digit passcode issued from the admin panel.

If install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, uninstall any existing
copy of the app first — see the signing note below.

## Signing — read before wider distribution

These are signed with the **Android debug key**, because `android/app/build.gradle.kts`
still points the `release` build type at `signingConfigs.getByName("debug")` and no
release keystore exists in the driver app repo.

Consequences:

- Fine for sideloading to testers, which is what these builds are for.
- Cannot be uploaded to Google Play.
- Will not install *over* a Play-installed copy; Android rejects the signature
  mismatch. Testers must uninstall the existing app first.

For a Play release, the driver app repo needs a real keystore plus a
`key.properties`, and Play expects an `.aab` (`flutter build appbundle`) rather
than an APK.

## Notes for testers

- Enabling Android developer options shows a "this activity has been recorded"
  warning dialog and logs a security event. It does **not** block the app.
- Mock/fake GPS **is** blocked: location-dependent actions fail with a security
  error while a mock provider is active.

## Cleanup

This directory exists only to hand the binaries over. Delete the branch once the
files are downloaded so the admin repo does not carry 100 MB of build output.
