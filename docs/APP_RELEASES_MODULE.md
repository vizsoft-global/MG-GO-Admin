# App Releases Module — Admin + Driver App

> Android sideload OTA for the Musallam / MGGO driver app.  
> Admin route: **`/app-releases`**  
> Permission: **`releases.manage`**  
> Ops checklist (upload every build): [`APP_RELEASES_RUNBOOK.md`](./APP_RELEASES_RUNBOOK.md)

This document explains **how the module is built** and **what is covered on Admin vs Driver (user) app**.

---

## 1. What this module solves

Drivers install the app outside Play Store (sideload APK). Ops needs to:

1. Upload a new APK
2. Choose which build drivers get (`Activate`)
3. Optionally force upgrade (`Required`)
4. See who is still on old versions (`Adoption`)

**Key rule:** Upload alone does nothing for drivers. Only an **Active** release on a channel is returned by the driver API.

---

## 2. How it is built (architecture)

```
┌─────────────────────┐     presign + PUT      ┌──────────────────┐
│  Admin /app-releases │ ─────────────────────► │  Cloudflare R2   │
│  (Next.js dashboard) │                        │  APK binaries    │
└──────────┬──────────┘                        └────────┬─────────┘
           │ register / activate / required              │
           ▼                                             │
┌─────────────────────┐   driver_get_active_app_release  │
│  Supabase Postgres  │ ◄────────────────────────────────┤
│  app_releases       │                                  │
│  drivers.*version*  │                                  │
└──────────┬──────────┘                                  │
           │                                             │
           │  GET /api/driver-app/active-release         │
           ▼                                             │
┌─────────────────────┐     presigned GET (15 min)       │
│  Driver Android app │ ◄────────────────────────────────┘
│  (Flutter)          │
└─────────────────────┘
```

| Layer | Technology | Role |
|-------|------------|------|
| Admin UI | Next.js App Router + TanStack Query | Upload, activate, required toggle, adoption |
| Storage | Cloudflare R2 | Private APK objects |
| Metadata | Supabase `app_releases` | Version, SHA256, active flag, required flag |
| Driver API | Next.js route + Supabase RPC | Auth’d version check + signed download URL |
| Adoption | `drivers` columns + `driver_app_version_history` | Last seen version per driver |

### Upload pipeline (admin)

1. `POST /api/admin/app-releases/presign` — validate metadata, return R2 PUT URL  
2. Browser `PUT` APK to R2 → `releases/android/{channel}/musallam-{versionCode}.apk`  
3. `POST /api/admin/app-releases/register` — HEAD object in R2, store SHA256 + row with `is_active: false`  
4. Admin clicks **Activate** (server action) → exactly one active row per `(platform, channel)`

### Driver check pipeline (user app)

1. On launch (and optionally on resume), call active-release API with Bearer token  
2. Optionally send current `versionCode` / `versionName` → server records adoption via `driver_record_app_version`  
3. If active `version_code` > installed → show update UI, download from `apk_url`, verify `apk_sha256`, install  
4. If `is_required` or below `min_supported_version_code` → block app until updated  

### Channels

| Channel | Typical use |
|---------|-------------|
| `internal` | Dev / QA devices |
| `beta` | Pilot drivers |
| `production` | Full fleet (default in UI) |

Platform today: **`android` only**.

---

## 3. Admin panel — what is covered

**UI:** `/app-releases` (sidebar: App Releases)  
**Gate:** `requirePermission(..., "releases.manage")` (super admin included)

### Releases tab (screenshot surface)

| Control | Behavior |
|---------|----------|
| Channel select | Filter list: production / beta / internal |
| **+ Upload APK** | Sheet: APK file, version name, version code, min supported code, required, release notes |
| **Configure storage** | One-time R2 CORS for localhost uploads |
| **Refresh** | Refetch release list |
| Version column | `version_name` + `code {version_code}`; **Latest** badge on highest code |
| Released / Size / SHA256 | Metadata + integrity fingerprint |
| **Required** switch | Force-update flag for that release (`markAppReleaseRequired`) |
| **Status** | Active (green) vs Inactive — only one Active per channel |
| **Activate** | Make this build the one drivers receive (rollback = activate older row) |
| Download | Presigned GET for staff to pull the APK |
| Delete | Remove inactive release + R2 object (active cannot be deleted) |

### Adoption tab

| Feature | Behavior |
|---------|----------|
| Version breakdown | Counts of drivers per `current_app_version_code` on channel |
| Drill-down sheet | Drivers on a given code (name, code, last seen) |
| Source of truth | Written when driver calls active-release with `versionCode` |

### Also available (not only UI)

| Path | Purpose |
|------|---------|
| `npm run publish:apk` | CLI upload/register/activate from IDE |
| Admin audit | Mutations logged via `logAdminMutation` |

### Constraints enforced in admin

- APK only, max **100 MB**
- `version_code` must be **strictly higher** than existing on same channel
- Unique `(platform, channel, version_code)`
- Same release keystore expected across production builds (process rule, not DB-enforced)

### Key admin code

| Path | Role |
|------|------|
| `src/app/[locale]/(dashboard)/app-releases/page.tsx` | Route + permission |
| `src/features/app-releases/app-releases-page-shell.tsx` | Releases UI |
| `src/features/app-releases/app-releases-adoption-panel.tsx` | Adoption UI |
| `src/features/app-releases/app-releases-actions.ts` | List / activate / required / delete / adoption |
| `src/features/app-releases/app-release-upload-client.ts` | Presign → PUT → register |
| `src/app/api/admin/app-releases/presign/route.ts` | Presigned upload |
| `src/app/api/admin/app-releases/register/route.ts` | Register after upload |
| `src/app/api/admin/app-releases/setup-cors/route.ts` | R2 CORS helper |
| `scripts/publish-app-release.mjs` | CLI publisher |

### Schema (admin-owned)

Migration: `supabase/migrations/20260707110000_app_releases.sql`

`app_releases`: `platform`, `channel`, `version_name`, `version_code`, `min_supported_version_code`, `apk_object_key`, `apk_size_bytes`, `apk_sha256`, `release_notes`, `is_required`, `is_active`, `released_at`, `released_by`.

Unique partial index: one `is_active = true` per `(platform, channel)`.

Adoption migration: `20260710100000_app_release_adoption.sql` — columns on `drivers` + `driver_app_version_history` + RPCs.

---

## 4. Driver (user) app — what is covered

The mobile app does **not** host APKs. It consumes the admin API and installs the binary on-device.

### Contract

**Endpoint:** `GET /api/driver-app/active-release`  
**Auth:** `Authorization: Bearer <driver_supabase_access_token>` (rider / driver only)  
**CORS:** Enabled for app origins

| Query | Default | Notes |
|-------|---------|-------|
| `platform` | `android` | Only `android` supported |
| `channel` | `production` | Must match how the build is published |
| `versionCode` | — | Current build number → adoption tracking |
| `versionName` | — | Current version string → adoption tracking |

**Response when an active release exists:**

```json
{
  "version_name": "1.0.8",
  "version_code": 43,
  "min_supported_version_code": null,
  "apk_url": "https://...presigned...",
  "apk_size_bytes": 76441190,
  "apk_sha256": "...",
  "release_notes": "Bug fixes",
  "is_required": true
}
```

- `null` body → no active release for that channel  
- `apk_url` TTL ≈ **15 minutes** — download promptly  
- Always verify file against `apk_sha256` before install  

### Driver app responsibilities (must implement)

| Area | Expected behavior |
|------|-------------------|
| Version check | Call API on cold start (and preferably app resume) |
| Optional update | If server `version_code` > local → dialog with notes + Download |
| Required / force update | If `is_required` **or** local code &lt; `min_supported_version_code` → non-dismissible blocker |
| Download | HTTP GET `apk_url` to app-private storage |
| Integrity | SHA-256 match before prompting installer |
| Install | Android package installer / install-unknown-apps flow |
| Signing continuity | New APK must be signed with same keystore or install fails |
| Adoption | Always send `versionCode` (+ `versionName`) so Admin Adoption tab stays accurate |
| Channel | Production builds use `channel=production`; internal/beta builds use matching channel |

### Driver-facing RPCs (via API, not called raw by UI)

| RPC | Purpose |
|-----|---------|
| `driver_get_active_app_release` | Active row metadata (no URL) |
| `driver_record_app_version` | Upsert `drivers.current_app_*` + history on code change |

API route adds the R2 **presigned GET** as `apk_url`.

### Key server code for drivers

| Path | Role |
|------|------|
| `src/app/api/driver-app/active-release/route.ts` | Public driver contract |
| `src/lib/storage/app-release-url.ts` | Presigned download URL |
| `src/lib/storage/driver-upload-auth.ts` | Bearer → driver identity |

---

## 5. End-to-end flow (both sides)

```
1. Flutter: bump pubspec  version: 1.0.8+43
2. Flutter: flutter build apk --release
3. Admin: Upload APK on /app-releases (or npm run publish:apk)
4. Admin: Activate (and optionally Required)
5. Driver: launches → GET active-release
6. Driver: if newer → download + SHA verify + install
7. Admin: Adoption tab shows who moved to code 43
```

Recommended rollout: `internal` → `beta` → `production`.

---

## 6. Permissions & security

| Concern | Implementation |
|---------|----------------|
| Who can manage releases | `releases.manage` (admin panel) |
| Who can fetch active APK | Authenticated rider (`is_rider`) |
| APK privacy | R2 private; short-lived signed URLs only |
| Integrity | SHA-256 stored at register; client must verify |
| Rollback | Activate previous inactive row (no re-upload needed if still in R2) |

---

## 7. Related docs

| Doc | Use |
|-----|-----|
| [`APP_RELEASES_RUNBOOK.md`](./APP_RELEASES_RUNBOOK.md) | Step-by-step publish checklist + CLI flags + errors |
| [`DRIVER_APP_HANDOFF.md`](./DRIVER_APP_HANDOFF.md) | Broader mobile contracts (paste into driver-app session) |

---

## 8. Quick file map

```
Admin UI     →  /app-releases
Feature      →  src/features/app-releases/*
Admin APIs   →  src/app/api/admin/app-releases/*
Driver API   →  src/app/api/driver-app/active-release/route.ts
Migrations   →  20260707110000_app_releases.sql
                20260710100000_app_release_adoption.sql
CLI          →  npm run publish:apk
R2 key       →  releases/android/{channel}/musallam-{versionCode}.apk
```
