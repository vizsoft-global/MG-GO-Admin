#!/usr/bin/env node
/**
 * Sideload / in-app APK publishing removed (Play Store policy).
 * Use the driver app's ./scripts/build_play.sh and Google Play Console instead.
 */
console.error(
  "publish-app-release is disabled: in-app APK / sideload OTA was removed.\n" +
    "Ship updates via Google Play only (Flutter: scripts/build_play.sh).",
);
process.exit(1);
