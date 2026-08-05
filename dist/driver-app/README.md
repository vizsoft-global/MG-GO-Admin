# Driver app test build — 1.0.7 (build 7)

Test-only builds of the Musallam Delivery driver app, for handing to QA.

Pick **one** file to match the tester's device. Each APK contains only its own
CPU architecture, so the wrong one will refuse to install rather than installing
and then crashing.

| File | Size | Give it to |
|---|---|---|
| `mg-go-driver-1.0.7-arm64-v8a.apk` | 29 MB | **Real phones.** Every 64-bit Android device on Android 7.0+. This is the one you want. |
| `mg-go-driver-1.0.7-x86_64-emulator.apk` | 31 MB | Android emulators (Android Studio AVDs) only. |

Built from `vizsoft-global/DPD-userapp` `main` @ `e726d08`.

- Package: `kw.musallam.delivery`
- Version: `1.0.7` (build 7)
- Min Android 7.0 (API 24), targets API 36
- Backend: Supabase `eoksxkdssptgyqyywdju` (production — real driver data)

## Verify the download before sending it on

A truncated download is the usual cause of **"App not installed as package
appears to be invalid"**. Confirm the file is complete first — the size must
match exactly, to the byte:

| File | Bytes | SHA-256 |
|---|---|---|
| `mg-go-driver-1.0.7-arm64-v8a.apk` | 30607471 | `e66689bea678defd94ac5266bc0672ad3905418cd55b1e0dbe9ac51ca8db36bf` |
| `mg-go-driver-1.0.7-x86_64-emulator.apk` | 32116317 | `b33df7bf05738873b78b33f7b83a5507d3c12de4fadad075ba3ed74505d6880c` |

```bash
shasum -a 256 mg-go-driver-1.0.7-arm64-v8a.apk   # macOS / Linux
certutil -hashfile mg-go-driver-1.0.7-arm64-v8a.apk SHA256   # Windows
```

If the checksum does not match, the download is corrupt — re-download it.

## Sending it to a tester

Use a transfer that does not re-encode files: Google Drive, Dropbox, or a USB
cable. **Do not send the APK over WhatsApp or Telegram as an image/media
attachment**, and avoid email clients that rewrite attachments — these are a
common source of truncated, uninstallable APKs.

On the phone: open the file, approve "install from unknown sources", then sign
in with a driver code and 6-digit passcode issued from the admin panel.

## Troubleshooting install failures

### "package conflicts with an existing package"

The device already has `kw.musallam.delivery` installed, signed with a different
key. Android never lets one signing key replace another, so the install is
refused. **Fully uninstall the existing app, then install this APK.**

```bash
adb uninstall kw.musallam.delivery
```

Or on the phone: Settings → Apps → Musallam → Uninstall.

If the error persists after uninstalling from the launcher, a copy is still
installed under another user profile — a work profile, a second user, or a
"Dual Apps" / cloned instance. Check every profile and remove it from each:

```bash
adb shell pm list users
adb shell pm list packages --user 0 | grep musallam   # repeat per user id
adb shell pm uninstall --user 0 kw.musallam.delivery  # repeat per user id
```

Uninstalling clears local app data, so the tester signs in again with their
driver code and passcode. Nothing server-side is lost.

### "package appears to be invalid"

The download was truncated. Re-check the byte size and checksum above before
transferring the file again.

## Signing — read before wider distribution

These are signed with the **Android debug key**, because
`android/app/build.gradle.kts` in the driver app repo still points the `release`
build type at `signingConfigs.getByName("debug")` and no release keystore exists
there.

- Fine for sideloading to testers, which is what these builds are for.
- Cannot be uploaded to Google Play.
- Will not install *over* a Play-installed copy — Android rejects the signature
  mismatch with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Uninstall the existing app
  first.

For a Play release the driver app repo needs a real keystore plus a
`key.properties`, and Play expects an `.aab` (`flutter build appbundle`).

## Notes for testers

- Enabling Android developer options shows a "this activity has been recorded"
  warning and logs a security event. It does **not** block the app.
- Mock/fake GPS **is** blocked: location-dependent actions fail with a security
  error while a mock provider is active.

## Cleanup

This directory exists only to hand the binaries over. Delete the branch once the
files are downloaded so the admin repo does not carry build output.
