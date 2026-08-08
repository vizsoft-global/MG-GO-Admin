# App Releases — DECOMMISSIONED

> **Status:** Permanently removed (Google Play policy).  
> **Do not** upload APKs, activate releases, or use channels for driver updates.

## Current behavior

| Surface | Behavior |
|---------|----------|
| UI `/app-releases` | Tombstone page (“App Releases removed”) |
| `POST /api/admin/app-releases/presign` | **410** `sideload_removed` |
| `POST /api/admin/app-releases/register` | **410** `sideload_removed` |
| `POST /api/admin/app-releases/setup-cors` | **410** `sideload_removed` |
| `scripts/publish-app-release.mjs` | Exits disabled |
| `GET /api/driver-app/active-release` | Adoption ping only — **always returns `null`** (no `apk_url`) |

## How drivers get updates

1. Build the driver app Play AAB (`./scripts/build_play.sh` in the driver repo).
2. Upload to Google Play Console.
3. Drivers install/update **only** from Google Play.

Driver contract details: [`DRIVER_APP_HANDOFF.md`](./DRIVER_APP_HANDOFF.md) **§9a**.

Historical schema (`app_releases` table, sideload flag) is retained for DB history only — not an active product path.
