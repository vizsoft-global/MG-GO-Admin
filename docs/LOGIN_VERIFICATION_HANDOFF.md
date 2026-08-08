# Handoff: Driver Login Photo Verification (Admin)

**From:** Driver App (`MG-GO` / `dpd_userapp`)  
**To:** Admin API + Supabase (`MGgo-Admin` → driver-facing **`dpdadmin-prod`**)  
**Date:** 2026-07-30 (env notes updated 2026-08-08)  
**Scope of this handoff:** Backend allowlist + DB audit trail only. **Admin UI to view photos is a later task.**

---

## 1. What the Driver App will do

After successful passcode login (`driver-passcode-login` → Supabase session), and **before** Home:

1. Once per **device-local calendar day**, show a mandatory **Verify Identity** screen.
2. Capture a **live front-camera selfie only** after an on-device **blink liveness** challenge (`camera` + ML Kit). No gallery / file picker. Home is blocked until blink succeeds and the driver confirms the still.
3. On confirm:
   - Persist locally (including `liveness_passed` / `liveness_method`) and allow navigation to Home immediately (even offline).
   - Upload async via existing driver upload API:
     - `POST /api/driver-uploads/presign`
     - `PUT` to R2 (or `proxy` fallback)
     - `POST /api/driver-uploads/confirm`
   - `entityType`: **`login_verification`**
4. After upload confirm succeeds, call RPC:
   - `driver_record_login_verification(p_object_key text, p_liveness_passed boolean DEFAULT false, p_liveness_method text DEFAULT NULL)`
   - New APKs send `p_liveness_passed=true`, `p_liveness_method='mlkit_blink'`
5. If a pending upload is older than **24 hours** without success, force re-capture on the next login/gate check.

**Not using attendance tables** (`attendance_logs` / `driver_attendance`). This is a login-identity compliance audit, separate from shift check-in/out.

---

## 2. Admin API — required change (blocking)

### File

`src/lib/storage/driver-upload-keys.ts`  
(apply on the admin codebase deployed to **`dpdadmin-prod`**; ops testing deploy is optional and not a driver-app target)

### Add entity type

| entityType | Max size | Content types |
|------------|----------|---------------|
| `login_verification` | 5 MB | `image/*` |

Add to `DRIVER_UPLOAD_ENTITY_TYPES` and `ENTITY_RULES` (same rules as `driver_selfie`).

### Object key (already produced by `buildDriverObjectKey`)

```
drivers/{driverId}/login_verification/{UTC-date}/{uuid}.{ext}
```

### Do **not** reuse `driver_selfie`

Keep `login_verification` distinct so future Admin audit UI can filter login proofs separately from other selfie/docs.

### Existing `storage_uploads` audit

Completed uploads should continue to appear in `storage_uploads` (Settings → Cloudflare R2 / Driver app filter), same as other driver uploads.

### Environments

| Role | Admin deploy | R2 bucket | Supabase |
|------|--------------|-----------|----------|
| **Driver-facing (required)** | `dpdadmin-prod` / `dpdadmin-prod.vercel.app` | `dpd-private-prod` | `eoksxkdssptgyqyywdju` |
| Ops testing (optional, not driver target) | `dpdadmin` / `dpdadmin.vercel.app` | `dpd-private` | `ytfmsgckjatiserpgdbz` |

Ship allowlist + migration to **production** so the driver app works. Ops may mirror to testing if they still run that admin stack.

---

## 3. Supabase — required migration + RPC (blocking)

### New table: `public.driver_login_verifications`

Suggested schema:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `driver_id` | uuid NOT NULL | FK → `drivers(id)` ON DELETE CASCADE |
| `object_key` | text NOT NULL | R2 key from upload confirm |
| `captured_at` | timestamptz NOT NULL | Prefer app-supplied or `now()` at insert |
| `created_at` | timestamptz NOT NULL | default `now()` |
| `liveness_passed` | boolean NOT NULL | default `false`; Phase 1 soft (old APKs may insert false) |
| `liveness_method` | text NULL | e.g. `mlkit_blink` |

Indexes:

- `(driver_id, created_at DESC)` — driver detail / history
- Multiple captures/day are allowed (forced re-capture after stale upload)

RLS:

- Drivers: insert only via SECURITY DEFINER RPC (no direct client insert).
- Admins: select via existing admin role patterns (for future UI).

### RPC: `driver_record_login_verification(...)` (Phase 1 soft)

Mirror style of `driver_update_avatar`:

- Signature: `(p_object_key text, p_liveness_passed boolean DEFAULT false, p_liveness_method text DEFAULT NULL)`
- `SECURITY DEFINER`, `SET search_path = public`
- `v_uid := auth.uid()`; reject if null / not a driver
- Validate `p_object_key` non-empty and preferably prefix-matches  
  `drivers/{uid}/login_verification/`
- Insert `object_key` + `COALESCE(p_liveness_passed, false)` + `p_liveness_method`
- **Phase 1:** do **not** `RAISE 'liveness_required'` (old APKs must keep writing rows)
- **Phase 2 (follow-up only):** hard-enforce after fleet adoption
- Return `jsonb` including `liveness_passed` / `liveness_method`
- `GRANT EXECUTE ... TO authenticated`

Apply Phase-1 migration to **production** Supabase (`eoksxkdssptgyqyywdju` / `20260730120000_login_verification_liveness.sql`). Mirror to ops testing only if that stack is still used.

---

## 4. Driver App ↔ Admin contract (summary)

```
Driver App                          Admin API / Supabase
─────────                          ────────────────────
Login OK (session JWT)
  → needs capture today?
  → front camera + blink liveness → still
  → (offline OK) go Home
  → POST /api/driver-uploads/presign
       entityType=login_verification
  → PUT R2 / proxy
  → POST /api/driver-uploads/confirm
       → storage_uploads row (existing)
  → rpc driver_record_login_verification(
         p_object_key, p_liveness_passed, p_liveness_method)
       → driver_login_verifications row
```

Auth: Bearer Supabase access token on upload routes (same as avatar / order_proof).

---

## 5. Admin UI (driver detail)

**Implemented** on `/drivers/[id]` → **Login Verification** tab:

- Lists `driver_login_verifications` for `linked_profile_id` (newest first)
- Cursor pagination (page size 24) + date range filter on `captured_at`
- Thumbnails via `getPresignedGetUrl` (keys under `drivers/*/login_verification/` readable with `drivers.view`)
- Dialog lightbox (same pattern as Documents tab)
- Badge: **Liveness verified** / **Not verified** from `liveness_passed`
- **Exemptions (skip gate, no photo required):**
  - Global: `app_settings.driver_app_login_verification_exempt_all` — Settings → Driver App
  - Per-driver: `drivers.login_verification_exempt` — driver detail aside (`drivers.manage`)
  - App skips `/login-verification` when **global OR per-driver** is true (cached; fail-closed if never fetched)

**Still out of scope**

- Global cross-driver Login Verification list / nav item
- Retention / auto-delete of old photos
- Linking verification photos to attendance screens
- Phase-2 RPC hard-enforce (`RAISE liveness_required`)
- Separate permission slug beyond `drivers.view` / settings.manage for toggles

---

## 6. Acceptance checklist (Admin)

- [ ] `login_verification` accepted by presign/confirm/proxy on **prod** Admin
- [ ] Object lands in correct bucket under `drivers/{id}/login_verification/...`
- [ ] `storage_uploads` row created for the upload
- [ ] Migration applied: table + RPC (prod)
- [ ] Driver JWT can call RPC; non-driver / anon cannot
- [ ] Invalid / empty `object_key` rejected
- [ ] Driver detail Login Verification tab shows photos for linked drivers
- [ ] `drivers.view` can open signed login_verification images (no `drivers.manage` required)

---

## 7. Related docs

- `docs/DRIVER_APP_HANDOFF.md` §14 — upload API + allowed `entityType` list
- Driver App plan: Mandatory Login Photo Capture
