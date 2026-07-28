# App Releases — Runbook & Plan

> Android sideload OTA for the Musallam driver app.  
> Admin UI: **https://dpdadmin.vercel.app/app-releases**  
> Permission required: `releases.manage`

---

## Overview

| Component | Role |
|-----------|------|
| **Cloudflare R2** | Stores APK binaries |
| **Supabase `app_releases`** | Release metadata + which build is active per channel |
| **Admin panel `/app-releases`** | Upload, activate, required toggle, adoption |
| **Driver API** | `GET /api/driver-app/active-release` — version check + signed download URL |

**Key rule:** Upload alone does nothing for drivers. You must **Activate** the release after upload.

---

## Architecture

```
Dev IDE (Flutter build APK)
        │
        ▼
Admin /app-releases  ──►  POST /api/admin/app-releases/presign
        │                         │
        │                         ▼
        │                  Cloudflare R2
        │                  releases/android/{channel}/musallam-{versionCode}.apk
        │
        ├──►  PUT APK to presigned URL
        │
        ├──►  POST /api/admin/app-releases/register  ──►  Supabase app_releases (is_active: false)
        │
        └──►  Activate (server action)  ──►  one active row per channel

Driver app on launch
        │
        └──►  GET /api/driver-app/active-release  ──►  version + apk_url + sha256
```

---

## Prerequisites (one-time)

- [ ] Admin account has **`releases.manage`** permission (super admin included)
- [ ] R2 env vars configured on Vercel (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)
- [ ] If uploading from **localhost**: open `/app-releases` → click **Configure storage** once (applies R2 CORS for your dev origin)
- [ ] Release keystore stored safely — every production build must use the **same** signing key

---

## Release checklist (every build)

### Phase 1 — Prepare (driver app repo / IDE)

- [ ] Bump version in `pubspec.yaml`:

  ```yaml
  version: 1.0.10+11   # 1.0.10 = versionName, 11 = versionCode
  ```

- [ ] Confirm `versionCode` (build number) is **higher** than the latest on the target channel (see admin UI hint or Adoption tab)
- [ ] Build release APK:

  ```bash
  flutter build apk --release
  ```

  Typical output: `build/app/outputs/flutter-apk/app-release.apk`

- [ ] Note **version name** and **version code** — they must match what you enter in admin

---

### Phase 2 — Upload (admin panel)

1. Open **https://dpdadmin.vercel.app/app-releases**
2. Select **channel**:
   | Channel | Use |
   |---------|-----|
   | `internal` | Dev / QA |
   | `beta` | Wider pre-prod test |
   | `production` | Live drivers |
3. Click **Upload APK**
4. Fill form:

   | Field | Required | Notes |
   |-------|----------|-------|
   | APK file | Yes | `.apk` only, max 100 MB |
   | Version name | Yes | e.g. `1.0.10` — match `pubspec.yaml` |
   | Version code | Yes | Integer, must be > latest on channel |
   | Channel | Yes | Usually test `internal` first |
   | Min supported version code | No | Block older builds below this code |
   | Required update | No | Force drivers to upgrade |
   | Release notes | No | Shown in driver update prompt |

5. Submit — wait for: **Preparing → Uploading → Saving**

**Upload pipeline (what happens under the hood):**

1. `POST /api/admin/app-releases/presign` — validates metadata, returns R2 PUT URL  
2. Browser PUTs APK to R2 at `releases/android/{channel}/musallam-{versionCode}.apk`  
3. `POST /api/admin/app-releases/register` — verifies file in R2, stores SHA256 + metadata (`is_active: false`)

---

### Phase 3 — Go live (activate)

- [ ] In the releases table, click **Activate** on the new row
- [ ] Confirm status badge shows **Active**
- [ ] (Optional) Toggle **Required** if this is a mandatory security/fix release
- [ ] (Optional) Set **min supported version code** to block very old builds

**Only one release can be active per channel.** Activating a new one deactivates the previous.

---

### Phase 4 — Verify

- [ ] Install or open driver app on a test device
- [ ] App should detect newer `version_code` and offer download
- [ ] Check **Adoption** tab in admin — driver version reports after launch
- [ ] (Optional) API smoke test:

  ```http
  GET https://dpdadmin.vercel.app/api/driver-app/active-release?platform=android&channel=production&versionCode=10&versionName=1.0.9
  Authorization: Bearer <driver_supabase_access_token>
  ```

  Expected fields: `version_code`, `version_name`, `apk_url`, `apk_sha256`, `apk_size_bytes`, `is_required`, `release_notes`

---

## Recommended channel strategy

```
internal  →  smoke test on dev devices
    ↓
beta      →  wider QA / pilot drivers
    ↓
production →  full fleet rollout
```

Do **not** skip `internal` for risky changes.

---

## Constraints & errors

| Rule | Detail |
|------|--------|
| Version code | Must be strictly higher than latest on same channel |
| Duplicate code | Rejected — each `(platform, channel, version_code)` is unique |
| Max size | 100 MB |
| Active delete | Cannot delete active release — activate another first |
| Signing | Same release keystore across all production builds |

| Error | Fix |
|-------|-----|
| `version_code_not_higher` | Bump build number in `pubspec.yaml` |
| `r2_cors_or_network` | Click **Configure storage** on `/app-releases` |
| `not_authorized` | Ask super admin for `releases.manage` |
| `r2_not_configured` | Check Vercel R2 env vars |

---

## Driver app contract

**Endpoint:** `GET /api/driver-app/active-release`

| Query param | Default | Values |
|-------------|---------|--------|
| `platform` | `android` | `android` only |
| `channel` | `production` | `production`, `beta`, `internal` |
| `versionCode` | — | Current app build number (for adoption tracking) |
| `versionName` | — | Current app version string |

**Response (when update available):**

```json
{
  "version_name": "1.0.10",
  "version_code": 11,
  "min_supported_version_code": null,
  "apk_url": "https://...presigned...",
  "apk_size_bytes": 45678901,
  "apk_sha256": "abc123...",
  "release_notes": "Bug fixes",
  "is_required": false
}
```

Returns `null` when no active release exists for the channel.

---

## Storage paths

| Item | Path |
|------|------|
| R2 object key | `releases/android/{channel}/musallam-{versionCode}.apk` |
| DB table | `public.app_releases` |
| Active index | One `is_active = true` per `(platform, channel)` |

---

## CLI publish (from IDE)

Use the local CLI when you have `.env.local` configured in `dpdadmin/` (same credentials as `bootstrap:admin` and `migrate:storage-r2`).

### One-time CLI setup

Add to [`dpdadmin/.env.local`](dpdadmin/.env.local):

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Register/activate releases |
| `R2_ACCOUNT_ID` | Yes | Cloudflare R2 upload |
| `R2_ACCESS_KEY_ID` | Yes | Cloudflare R2 upload |
| `R2_SECRET_ACCESS_KEY` | Yes | Cloudflare R2 upload |
| `R2_BUCKET_NAME` | Yes | Cloudflare R2 upload |
| `R2_S3_ENDPOINT` | No | Custom R2 endpoint |
| `ADMIN_EMAIL` | No | Sets `released_by` on the release row |

### Full IDE workflow

```bash
# 1. In driver app repo — bump pubspec.yaml and build
flutter build apk --release

# 2. In dpdadmin — publish (internal first)
cd dpdadmin && npm run publish:apk -- \
  --apk ../driver-app/build/app/outputs/flutter-apk/app-release.apk \
  --pubspec ../driver-app/pubspec.yaml \
  --channel internal \
  --activate
```

When ready for fleet rollout, repeat with `--channel production --activate`.

### CLI commands

**Publish** (upload + register, optional activate):

```bash
npm run publish:apk -- \
  --apk path/to/app-release.apk \
  --pubspec path/to/pubspec.yaml \
  --channel internal \
  --release-notes "Bug fixes" \
  --required \
  --activate
```

Or pass version explicitly (no pubspec):

```bash
npm run publish:apk -- \
  --apk path/to/app-release.apk \
  --version-name 1.0.10 \
  --version-code 11 \
  --channel internal \
  --activate
```

**List** releases on a channel:

```bash
npm run publish:apk -- list --channel production
```

**Dry run** (validate only, no R2/DB writes):

```bash
npm run publish:apk -- \
  --apk path/to/app-release.apk \
  --pubspec path/to/pubspec.yaml \
  --channel internal \
  --dry-run
```

### CLI flags

| Flag | Default | Notes |
|------|---------|-------|
| `--apk` | required | Path to built `.apk` |
| `--pubspec` | — | Parse `version: 1.0.10+11` from pubspec.yaml |
| `--version-name` | from pubspec | e.g. `1.0.10` |
| `--version-code` | from pubspec | Integer build number |
| `--channel` | `internal` | `production` \| `beta` \| `internal` |
| `--release-notes` | — | Optional text |
| `--min-supported` | — | Optional minimum supported version code |
| `--required` | false | Force drivers to upgrade |
| `--activate` | false | Go live immediately after upload |
| `--dry-run` | false | Validate only |

**Note:** Without `--activate`, the release is registered but inactive — drivers won't receive it until you activate via CLI (`--activate`) or admin UI.

### CLI vs admin UI

| Method | When to use |
|--------|-------------|
| **CLI** (`npm run publish:apk`) | After `flutter build apk` from IDE; fastest repeat workflow |
| **Admin UI** (`/app-releases`) | Manual upload, adoption drill-down, required toggle after the fact |

Both write to the same R2 path and `app_releases` table.

---

## Quick reference

| Step | Action |
|------|--------|
| 1 | Bump `pubspec.yaml` |
| 2 | `flutter build apk --release` |
| 3 | `npm run publish:apk -- ... --activate` **or** admin UI upload |
| 4 | Verify on test device + Adoption tab |

**Production URL:** https://dpdadmin.vercel.app/app-releases
