# App Releases runbook — DECOMMISSIONED

> **Status:** Permanently removed. There is no APK upload / activate / channel publish path.

## Do not

- Open `/app-releases` to push APKs (page is a tombstone only)
- Run `publish-app-release` / any `publish:apk` workflow
- Toggle sideload updates (forced off; UI removed)
- Use `internal` / `beta` / `production` as update-distribution channels

## Do

1. Ship driver updates via **Google Play** only.
2. Optional: drivers may call `GET /api/driver-app/active-release` on **prod admin** (`https://dpdadmin-prod.vercel.app`) for version adoption telemetry — response is always `null`.

Full driver distribution rules: [`DRIVER_APP_HANDOFF.md`](./DRIVER_APP_HANDOFF.md) **§9a**.  
Module status: [`APP_RELEASES_MODULE.md`](./APP_RELEASES_MODULE.md).
