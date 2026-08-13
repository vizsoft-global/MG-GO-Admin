# DPD / Musallam Driver App — Handoff Document

> **Paste this entire file** into a new AI session when building the driver mobile app.  
> It stays in sync with the admin panel (`MGgo-Admin` / `dpdadmin`).  
> **Driver-facing stack (required):** Supabase `eoksxkdssptgyqyywdju` · Admin https://dpdadmin-prod.vercel.app · Firebase `musallam-delivery-prod`  
> See **§1a**. Ops may still run a separate testing admin; it is **not** a driver-app target.

---

## 1a. Environments (driver vs ops)

### Driver app — production only

| | **Production** (driver-facing) |
|---|-------------------------------|
| Supabase ref | `eoksxkdssptgyqyywdju` (`dpd-production`) |
| Firebase GCP | `musallam-delivery-prod` |
| R2 bucket | `dpd-private-prod` |
| Admin Vercel | `dpdadmin-prod` → https://dpdadmin-prod.vercel.app |
| Mobile config | `docs/firebase-prod/*` + `env/prod.json` on the driver app |

**Production Firebase app IDs** (live):

| Platform | App ID |
|----------|--------|
| Android | `1:579224507592:android:eaa8cdda265bc0914981fd` (`com.musallam_delivery.app`) |
| iOS | `1:579224507592:ios:53130e94d3c1f1364981fd` |
| Web | `1:579224507592:web:566afbce6fb96ae84981fd` |

### Ops / testing (not a driver-app target)

A testing admin stack may still exist for internal ops (`ytfmsgckjatiserpgdbz`, `dpdadmin.vercel.app`, `dpd-private`, `musallam-delivery-kw`). Do **not** point the shipped driver app at it. Infrastructure code: `infra/` · Runbook: `infra/README.md`.

---

## 1. Project context

**Musallam Delivery** is an enterprise rider workforce platform in Kuwait (currency **KWD**). Riders work with external partners (**Talabat**, **Door Dash**, **Uber Eats**) — orders are fulfilled in partner apps; our app wraps **delivery logging, compliance, earnings, HR requests, and Control Tower support**.

The **admin panel** verifies deliveries, approves requests, manages zones/vehicles, sends notifications, and chats with riders. **This document** defines what the driver app must read/write so both sides stay aligned.

---

## 2. Auth (driver app)

| Item | Value |
|------|-------|
| **Primary method** | `driver_code` + **6-digit App Passcode** (issued by admin on **Verify & approve**) |
| Fallback (legacy) | Phone **+965** + OTP — only for intakes approved before admin-first provisioning |
| Profile table | `profiles` where `role = 'rider'` |
| Driver row | `drivers` where `id = auth.uid()` (1:1 with profile) |
| Locale | `profiles.locale` — `en` \| `ar` |
| Admin block | `role = 'staff'` users use email login on web only |

### 2a. App passcode login (default after first link)

The admin panel auto-issues a **6-digit numeric passcode** (`drivers.app_passcode`) the moment a driver row transitions to `status = 'active'`. Admins share it privately with the driver and the driver enters `driver_code + passcode` on the login screen.

1. App calls RPC `select * from public.driver_app_lookup_by_passcode(p_driver_code, p_passcode)` (granted to `anon`).
2. RPC returns `{ ok: true, user_id }` only when the driver row is `active`, not archived, not blocked, and both values match. Errors: `invalid_credentials`, `driver_not_active`, `driver_archived`, `driver_blocked` (includes `message` = admin reason). Edge `driver-passcode-login` forwards those codes. The login screen **must** map `driver_archived` to a dedicated “account has been archived” message — never to invalid employee ID / passcode.
3. With `user_id` in hand, exchange for a real Supabase session — easiest path: call a service-role edge function that issues an OTP / magic-link / signed JWT for that `auth.users.id` (we do **not** ship the service-role key in the app).
4. Admin can rotate via `select public.regenerate_driver_app_passcode(p_driver_id)` (staff only via RLS helper `is_admin_panel_user()`); rotation invalidates the old code immediately.
5. The passcode is plaintext in `drivers.app_passcode` so admin staff can read it out to the driver. Treat it as a shared secret — show it only behind the staff "reveal" gesture.

**Constraints already enforced in DB:**

- `app_passcode ~ '^[0-9]{6}$'` (check constraint)
- `UNIQUE` partial index across non-null values (no two drivers share a code)
- `BEFORE INSERT OR UPDATE OF status` trigger mints a code the first time `status` becomes `active`
- **`drivers.status = 'active'` is blocked** unless the driver has ≥1 **published + active** restaurant in `driver_restaurants` (helper `driver_has_active_restaurant`, trigger on `drivers` + auto-downgrade when restaurants are removed). Admins set status via RPC `set_driver_account_status(p_driver_id, p_status)` on `/drivers/[id]`.
- **Admin app block** (`drivers.is_blocked`, `drivers.blocked_reason`): separate from account status. Admins block/unblock on `/drivers/[id]` via RPC `set_driver_blocked(p_driver_id, p_blocked, p_reason)`. Blocking forces `is_on_duty = false`. On login, `driver_app_lookup_by_passcode` returns `{ ok: false, error: 'driver_blocked', message: '<reason>' }`. For signed-in sessions, subscribe to `drivers` realtime and read `is_blocked` + `blocked_reason`; show a full-screen block view when blocked.

### 2b. Admin-first provisioning (default)

Staff use **Verify & approve** on `/drivers/[id]` (or bulk import with **Approve immediately**). Server action creates `auth.users` (phone + synthetic email `{driver_code}@driver.dpd.local`) then RPC `admin_approve_driver(p_intake_id, p_user_id, p_email)`:

- Inserts `profiles` + `drivers`, copies `driver_intake_restaurants` → `driver_restaurants`, sets `drivers.status = 'active'`, mints `app_passcode`, marks intake `linked`.
- Driver signs in with **driver_code + passcode** via edge function `driver-passcode-login` (magic link on synthetic email).

`employee_id` on intakes/drivers: **required**, 1–8 digits, unique.

`nationality` on intakes/drivers: **optional**, ISO 3166-1 alpha-2 code (e.g. `KW`, `IN`). Admin create/edit uses searchable country list; copied to `drivers` on **Verify & approve**.

`rider_category` on intakes/drivers: **`in_house`** (direct workforce) or **`outsourced`** (third-party). Required on admin create/edit; defaults to `in_house`; copied to `drivers` on approve. Admin list + detail show the label; mobile app may read from `drivers.rider_category` when needed for reporting/UI.

### 2c. Legacy OTP bootstrap (old intakes only)

For intakes still `linked = false` from before admin-first approval, the driver may OTP once to bind phone to `auth.users`.

**On first login (OTP success):** call `link_driver_by_phone(phone)` (RPC or edge function — implement in Supabase when wiring the app):

1. Normalize phone to `+965XXXXXXXX`.
2. **If** a `driver_intakes` row exists with that phone and `linked = false`:
   - Create/update `profiles` (`role = 'rider'`, intake `full_name`, `phone`, `civil_id` if stored on profile).
   - Insert `drivers` (`id = auth.uid()`, `driver_code`, `partner_id`, `zone_id`) as needed for the app.
   - Copy R2 objects `drivers/intakes/{intakeId}/{doc_type}.{ext}` → `drivers/{driverId}/{doc_type}.{ext}` (S3 CopyObject, same private bucket).
   - Insert `driver_documents` rows; sync `asset_assignments` from intake (catalog-based inventory; legacy `assets_issued` jsonb deprecated).
   - If intake has `vehicle_id`, set `vehicles.current_driver_id = auth.uid()`.
   - Set intake `linked = true`, `linked_profile_id = auth.uid()`, legacy `status = 'linked'`.
   - Or call RPC: `select mark_driver_intake_linked(p_phone, p_profile_id)`.
3. **Else** (no intake): create minimal `profiles` + `drivers` (self-signup path).

Admin panel creates `driver_intakes` via **Add Driver**, **bulk import**, or edit; auth users are created on **Verify & approve** (not on intake insert alone).
- `employee_id` required on every intake (1–8 digits)
- `linked = false` until **Verify & approve** (or legacy OTP link)

| Table / bucket | Admin | Driver app |
|----------------|-------|------------|
| `driver_intakes` | insert (staff RLS) | read on link (service role / RPC) |
| R2 `drivers/intakes/…` | admin upload (server) | copy to `drivers/{driverId}/…` on link |
| `drivers` | — | row after OTP link |
| `profiles.phone` | duplicate check on create | unique identity for link |

---

## 3. Screen inventory (user app → admin + tables)

| # | Driver screen | Admin module | Tables (read / write) |
|---|---------------|--------------|------------------------|
| 1 | Login (driver code + 6-digit passcode) | Drivers | `drivers` R via `driver_app_lookup_by_passcode` |
| 1a | First-time link (8-digit mobile + OTP) | — | `auth.users` (one-shot bootstrap only) |
| 2 | OTP verification (first link only) | — | `auth` session |
| 3 | Home (online toggle, weekly KPIs, bumper bonus) | Dashboard, **Attendance** | `driver_sessions`, `attendance_logs` **W**, `driver_earnings_daily`, `offers`, `deliveries` |
| 4 | Deliveries list (calendar, + Add Delivery) | Live Deliveries | `deliveries` **W**, `partners` R |
| 5 | Add delivery (order ID + proof photo) | Live Deliveries (verify tab) | `deliveries` **W** → `status=pending` |
| 6 | Fuel expense form | Requests (Fuel tab) | `requests` **W** type=fuel |
| 7 | Fuel expense history | Requests | `requests` R |
| 8 | Loan request list | Requests (Loan tab) | `requests` R, `loan_terms` R |
| 9 | New loan request | Requests | `requests` **W**, admin sets `loan_terms` on approve |
| 10 | Leave request | Requests (Leave tab) | `requests` **W** type=leave |
| 11 | Complaint submit | Requests (Complaints) | `requests` **W** type=complaint |
| 12 | Wrong action details + history | Wrong Actions, Driver detail | `wrong_actions` R |
| 13 | Earnings (this week) | Earnings | `driver_earnings_daily` R, `offers` R |
| 14 | Notifications list | Notifications | `notifications` R (via push/inbox) |
| 15 | Hygiene task (photo submit) | Notifications (Hygiene) | `hygiene_submissions` **W** |
| 16 | Control Tower chat | Support (Conversations) | `support_threads`, `support_messages` **W** |
| 17 | SOS Emergency | Support (Tickets) | `support_tickets` **W** |
| 18 | Appointment booking | Support (Appointments) | `appointment_slots` R, `appointments` **W** |
| 19 | Vehicle info | Vehicles | `vehicles` R via `drivers.vehicle_id` |
| 20 | Profile | Drivers | `drivers`, `profiles`, `driver_documents` R |
| 21 | Zone warning (outside zone timer) | Live Deliveries (Outside Zone) | `zones.polygon`, `attendance_logs.zone_compliance` **W** |

**W** = driver insert/update own rows · **R** = driver select own rows

---

## 4. Database schema (driver-visible)

### `profiles` (existing)
- `id` uuid PK (= auth.uid)
- `role` — must be `rider`
- `phone`, `full_name`, `locale`, `avatar_url` (R2 object key — same value as `drivers.avatar_object_key`), `zone_id`

### `drivers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | FK → profiles.id |
| driver_code | text | Exactly 5 digits from global sequence (`10001`–`99999`), auto-assigned on admin create; never reused after archive |
| archived_at | timestamptz | Set when admin archives driver; archived drivers cannot log in |
| partner_id | uuid | Talabat etc. |
| zone_id | uuid | Assigned zone |
| status | enum | active, suspended, pending |
| base_earnings_kwd | numeric | |
| is_on_duty | boolean | Toggled on Home |
| current_lat, current_lng | numeric | Updated while online |
| vehicle_id | uuid | FK → vehicles |
| custom_fields | jsonb | Admin-defined dynamic fields (`custom_field_definitions`). Values are scalars (`string` / `number` / `boolean`) or, for **checkbox** defs that have `options`, a `string[]` of selected option values. Checkbox with empty options remains a boolean. |
| avatar_object_key | text | Profile photo R2 key (`driver-avatars/{id}/…` from the app, or `drivers/{id}/avatar.{ext}` from admin). Kept in lockstep with `profiles.avatar_url` and the linked intake. |
| avatar_updated_at | timestamptz | Set whenever the photo changes. |

**Live Tracking map:** pins come from `driver_locations`. On-duty drivers stay on the map at last-known coords even when GPS is quieter than 8 minutes (shown as a stale/alert pin). Cron `cleanup_stale_driver_locations` (every 2 min) deletes stale rows **except** `drivers.is_on_duty = true`. The duty tracker must keep sending heartbeats while In: indoor/coarse GPS (>100 m) re-sends the last good pin instead of skipping the report.

**Profile photo (admin ↔ app):** upload `entityType: driver_avatar`, then `driver_update_avatar(p_object_key)` (or rely on confirm/proxy, which now stamp the same columns). Display: read `drivers.avatar_object_key` (fallback `profiles.avatar_url`) and resolve with `GET /api/driver-uploads/read?objectKey=…`. That read route allows the rider’s current avatar key even when admin uploaded it (`uploaded_by` is staff). Do **not** treat `driver_selfie` or login-verification shots as the profile photo. Cache-bust the signed `readUrl` with a URL **fragment** (`#v={epoch}`), never an extra query param — `?v=` / `&v=` invalidates the R2 signature and the image falls back to initials after the in-memory preview is gone. Take a Photo must request camera permission *before* `ImagePicker`; a deny/dismiss shows a user-facing prompt, never a raw `PlatformException`.

### `deliveries`
| Column | Type | Notes |
|--------|------|-------|
| driver_id | uuid | = auth.uid() |
| partner_id | uuid | Selected partner |
| zone_id | uuid | Zone at time of delivery |
| restaurant_id | uuid | Optional FK → `restaurants` (merchant) |
| external_order_id | text | Order # from partner app. Unique index `deliveries_external_order_id_unique_idx`. Pickup RPC raises **`duplicate_order_id`** (including when the unique index fires). App must show a friendly string such as “This Order ID already exists.” — never the raw Postgres constraint message. |
| order_proof_url | text | R2 object key (`drivers/{id}/order_proof/...`) |
| status | enum | pending → admin sets verified/rejected |
| rejection_reason | text | Admin-authored when `status = rejected`. **Required on Delivery Details overlay** — select the column and show it under Status. Do not reuse `cancel_reason` (that is the rider cancel code). |
| delivered_at | timestamptz | Set on driver submit |
| delivered_lat, delivered_lng | numeric | GPS at submit time |

When admin sets `status = verified`, Postgres runs `recalculate_driver_earnings(driver_id, earn_date)` which updates `driver_earnings_daily` and syncs an approved `earning_credit` in `driver_wallet_entries`.

**Driver RLS:** `SELECT` / `INSERT` where `driver_id = auth.uid()` (migration `20260609100000_driver_deliveries_app.sql`).

**RPCs (authenticated rider):**

- `driver_check_order_id_available(p_external_order_id)` → `boolean`
- `driver_get_delivery_proximity_context()` → JSON: `proximity_meters`, driver `zone_id`, `zone_type`, `zone_geometry`, assigned `restaurants[]` with lat/lng
- `driver_create_delivery(p_external_order_id, p_order_proof_url?, p_delivered_lat?, p_delivered_lng?)` → `deliveries` row (`status = pending`, copies `partner_id` / `zone_id` from `drivers`). Raises `delivery_out_of_range` when proximity gate fails.

**Delivery proximity gate** (`app_settings.driver_app_delivery_proximity_meters`, default 500; `0` disables):

- Allow submit when driver GPS is **inside assigned zone** OR **within N meters of zone boundary** OR **within N meters of any assigned restaurant** (PostGIS on server; mirrored client-side for UX).
- Enforced in `driver_create_delivery` and pre-checked in the driver app Add Delivery screen.

### `restaurants` (admin-managed)
| Column | Type | Notes |
|--------|------|-------|
| partner_id | uuid | Optional FK → partners |
| zone_id | uuid | Optional FK → zones |
| name | text | Required display name |
| external_merchant_id | text | Optional ID from partner app |
| status | enum | draft, published, archived — only **published** rows are selectable for drivers |
| is_active | boolean | Must be true for driver activation gate |

Configured in admin **Settings → DPD → Restaurants**.

### `delivery_rules` / `incentive_rules` (admin-managed)
- Scope: `zone`, `partner`, or `restaurant` (exactly one FK per rule).
- `delivery_rules`: which verified deliveries count toward incentives (if none active globally, all verified deliveries count).
- `incentive_rules`: `period` (daily/weekly/monthly), `target_deliveries`, `reward_kwd`; matching rules **stack** (sum of rewards).
- Kuwait calendar for weekly (Mon–Sun) and monthly periods in SQL (`Asia/Kuwait`).

Admin UI: **DPD** (`/dpd`, `earnings.view` / `earnings.manage`). Legacy `/settings/dpd` redirects to `/dpd`.

### `requests` (RCM — Request & Complaint)
| Column | Type | Notes |
|--------|------|-------|
| request_code | text | **RCM-####** (allocator `allocate_request_code`) |
| request_type | text | FK → `request_type_definitions.key`. **Was an enum until 2026-08-12** — same values, same JSON on the wire, but the set is now a table an admin can add to |
| status | enum | draft, pending, submitted, in_review, needs_clarification, **rescheduled**, approved, rejected, solved, **responded**, **closed**, overdue |
| payload | jsonb | Type-specific Figma fields (leave_type, tenure_months, category, …) |
| current_step_label / current_step_order | text / int | Denormalized approval progress |
| amount_kwd | numeric | Loan/fuel amount (also in payload where typed) |
| start_date, end_date | date | Leave range |
| details | text | Legacy reason (prefer payload) |
| attachment_url | text | Legacy single file; prefer `request_attachments` |
| decision_reason | text | Set by admin on reject/clarify |
| needs_attention | bool | Admin list badge only (cleared on staff open); **no admin push** |
| completed_at | timestamptz | KPI avg resolution |
| acknowledged_at | timestamptz | Real column mirroring `payload.driver_ack_at` |
| sla_due_at | timestamptz | Deadline of the open step; NULL when the step has no SLA |
| closed_at / closed_by | timestamptz / uuid | Archive stamp (manual or auto-close) |
| fuel_transfer_type | text | `cash` \| `salary` — approver's payout choice, not rider input |

Related tables: `request_approval_steps`, `request_clarifications`, `request_attachments`.  
Config: `loan_tenure_options` (6 rows: 3/6/9/12/18/24 months) and `complaint_categories` (9 rows) were seeded 2026-08-12, so neither gate fires any more. Both remain admin-editable, so keep handling an empty list.  
**Driver RPCs (live):** `driver_create_request`, `driver_list_my_requests` (includes `payload`), `driver_get_request`, `driver_submit_clarification`, `driver_acknowledge_request` (clears `payload.awaiting_driver_ack`, sets `driver_ack_at`, raises Admin `needs_attention`). Final admin approve on `loan` / `asset` / `sick_leave` sets `payload.awaiting_driver_ack=true`.  
Loan submit requires rows in `loan_tenure_options`; complaint submit requires `complaint_categories` rows. Both are seeded as of 2026-08-12; the `tenure_options_not_configured` and `complaint_categories_not_configured` errors now only appear if an admin deactivates every option.

### Request types are data now (2026-08-12)

`public.request_type` was an 8-value Postgres enum. It is gone. A request type is a row in **`request_type_definitions`** (key, labels, `icon_key`, `is_active`, `sort_order`, `screenshot_restricted`, `terminal_status_on_approve`, `requires_driver_ack_on_approve`, `date_range_required`, `min_attachments`), and its form is described by **`request_field_definitions`** (`field_key`, `label_en`/`label_ar`, `kind`, `target`, `is_required`, `sort_order`, `options_source`, `options`, `min_value`/`max_value`). Both are readable by any authenticated rider for active types.

**Nothing in the current app breaks.** `p_type` on `driver_create_request` changed from the enum to `text`, which is the same `"leave"` string on the wire, and `request_type` still comes back as the same string in every RPC payload. Every gate and every error code behaves exactly as before — that was verified case by case against a pre-migration baseline.

Two behaviours are new, both strictly safer: a non-numeric `tenure_months` returns `tenure_options_not_configured` instead of raising an unhandled Postgres cast error, and a request type that has been deactivated is rejected with `request_type_inactive` (all 8 are active today).

Generic error codes a server-defined type can now produce, alongside the legacy ones the app already translates:

| Code | Meaning |
|---|---|
| `unknown_request_type` | No definition row for that key |
| `request_type_inactive` | Definition exists but `is_active = false` |
| `field_required:<field_key>` | A field with `is_server_required` was empty |
| `invalid_option:<field_key>` | Value is not in the field's option list (DB-backed **or** static) |
| `attachments_required` | Fewer attachments than `min_attachments` |

The 8 built-ins are **system types**. Their key cannot be renamed and they cannot be deleted or demoted, but their **fields are editable** as of 2026-08-13: the app renders every type — built-in and custom — from `request_field_definitions` (`DynamicRequestFormScreen`). A DB trigger (`rcm_guard_system_request_type`) still blocks delete / key rename / `is_system` flips. Static select/multiselect options are now validated server-side the same way as loan tenure and complaint categories (`invalid_option:<field_key>`). Older app builds that still ship handwritten forms will ignore extra fields and will not send newly required ones — `is_server_required` stays a separate toggle for that reason.

**Shipped in the app 2026-08-13.** The hub tiles come from `request_type_definitions` ordered by `sort_order` — an admin-created type is reachable without an app release — and **every** type is rendered by a generic form built from `request_field_definitions` (`lib/features/support/dynamic_request_form_screen.dart`). Built-in types keep their ARB titles and option labels so the Figma wording survives. A failed or pending tile fetch falls back to the built-in eight so the hub is never empty offline. `kind` values the renderer draws: `text`, `textarea`, `number`, `date`, `month`, `select`, `multiselect` (JSON string array in the payload), `checkbox`, `file`; `target` routes the value to the payload key or to the matching `requests` column. Client-side it enforces `is_required`, `date_range_required` and `min_attachments` before calling the RPC, and greys out submit when a field's `options_source` list is empty — the same rule the loan and complaint forms already used.

One rule worth knowing before the builder ships: the acknowledgement flag only applies when the type ends on `approved`. A type whose `terminal_status_on_approve` is `solved` never sets `payload.awaiting_driver_ack` — you do not acknowledge a resolution.

`driver_create_request` inserts the row with status `submitted`, not `pending` — show "Submitted" for it, including on the post-create confirmation screen. **As of 2026-08-12 `submitted` survives**: `rcm_materialize_approval_steps` no longer overwrites it with `in_review`, so a request reads Submitted until the first staff decision and In review after it.

**Three statuses that previously had no behaviour now do:**

| Status | Meaning | Rider action |
|---|---|---|
| `rescheduled` | An approver proposed different dates. The approval step stays open. `payload.awaiting_driver_reschedule = true` and `payload.reschedule` carries `proposed_start_date`, `proposed_end_date`, `proposed_by`, `proposed_at`, `note`. | **Required.** Call `driver_respond_reschedule(p_request_id, p_accept, p_note)`. Accept applies the dates to `start_date`/`end_date`; either answer returns the request to `in_review` for the same approver. Surface it in Action Required. |
| `responded` | Terminal. The `send_response` action on a complaint or salary justification; `decision_reason` holds the response text and `completed_at` is stamped. Counts as resolved. | None. |
| `closed` | Archived after a decision — set by staff, or automatically once `completed_at` is older than `app_settings.request_auto_close_days` (default 30). The decision itself is unchanged. | None. Treat as read-only history. |

Per-step SLA: `request_approval_steps` gained `started_at`, `actor_display_name`, `sla_due_at`, `breach_action`, `sla_breached_at`; `request_approval_step_templates` gained `sla_minutes` and `breach_action` (`notify` \| `escalate`). Admins set both from the workflow builder; values stay NULL until then, so the breach sweep is inert by default and **never** auto-decides a step.

Staff can also raise a request for a rider via `admin_create_request`. `p_type` is any active `request_type_definitions.key` (the Admin New-request dialog lists them all). Such rows are normal `requests` rows the driver sees in **Sent**, with `payload.created_on_behalf = true`, `created_on_behalf_by` (staff uuid), `created_on_behalf_by_name` and `created_on_behalf_at`. If the app shows an author line, use `created_on_behalf_by_name`; the approval chain, clarifications and acknowledgement flow are unchanged.

**Flutter routes (MG-GO):** Profile → Help & Support → `/profile/support` hub; forms `/profile/support/requests/new?type=…`; list/detail; **Action required** `/profile/support/action-required` (status `needs_clarification`, `payload.awaiting_driver_ack`, or `payload.awaiting_driver_reschedule`); visit book `/profile/support/visits/book`; my visits `/profile/support/visits`. Feature folder `lib/features/support/`. Attachments upload to Supabase bucket `request-attachments` under `{driver_id}/…`.

**Driver notifications (RCM/Visit/E-Sign):** On admin decide / visit status / e-sign send / appointment create, Postgres `notify_driver_transactional` inserts inbox campaign + dispatch item. Deep links: `musallam:///profile/support/requests/{id}`, `…/action-required`, `…/visits`, `…/sign/{id}`, `…/appointments`. `action_params.record_type` = `request` | `visit` | `esign` | `appointment`. No admin push for RCM attention.

### E-Sign + Appointments
| Piece | Notes |
|-------|-------|
| `esign_categories` | Figma-seeded categories + per-category screenshot_restricted |
| `esign_requests` | Code **SIG-####**; status pending/signed/expired/cancelled/declined; signature PNG in bucket `esign-documents` |
| `esign-documents` RLS (driver) | Three policies, all scoped to the caller: `esign_documents_driver_own` (write + read under `{uid}/…`), `esign_documents_driver_read_source` (**read the `document_storage_key` of your own request**, whatever prefix the admin used — added `20260829100000`), `esign_documents_driver_read_signed` (read the composed copy under `signed/…`). Before the source policy existed, admin uploads at `admin/{uuid}.{ext}` matched nothing and the viewer could never load its document. |
| Driver RPCs | `driver_list_esign_requests`, `driver_get_esign_request`, `driver_submit_esignature`, `driver_decline_esignature`, `driver_mark_esign_viewed` |
| Admin RPCs | `admin_list_esign_requests`, `admin_create_esign_request` |
| **Decline writes `declined`** | `driver_decline_esignature` set `cancelled` until `20260829110000`; it now sets **`declined`** and returns `{"ok":true,"status":"declined"}`. `cancelled` is reserved for admin-side cancellation, so the app must stop treating it as a decline (`support_models.dart` `isDeclined`). Reason still lands in `signer_meta.declined_reason` + `declined_at`. |
| **Declaration is now required server-side** | `driver_submit_esignature` rejects with `declaration_required` unless `p_signer_meta.declaration_accepted` is boolean `true`. Send `{"declaration_accepted": true, "declaration_text": "<exact text shown>"}`; the server overwrites `declaration_accepted` and stamps `declaration_accepted_at` with **server** time so the device cannot backdate it. The ticked box was previously client-only and left no record of what the rider agreed to. |
| Flutter | `/profile/support/sign` inbox → viewer → capture pad → confirmed |
| **Lifecycle timestamps are real columns** | `20260901100000` adds `sent_at`, `viewed_at`, `declined_at`, `declaration_accepted_at` to `esign_requests`, backfilled from `signer_meta`. `declined_at` and `declaration_accepted_at` previously lived only inside the jsonb, so nothing could filter or report on them; `viewed_at` was never recorded at all, which left the Figma detail timeline with a permanently blank Viewed step. `sent_at` is split from `created_at` so a future draft state has somewhere to land — today the only inserter sends on insert, so the two are equal. |
| **Read receipt** | `driver_mark_esign_viewed(p_id)` stamps `viewed_at`. First open wins — a later re-open never overwrites the first. Call it once the document is actually visible to the rider, not on screen mount: the app fires it after the signed URL resolves. Decline and submit also back-fill `viewed_at`, so an older build that never calls it still produces an honest timeline. Fire-and-forget: a failed receipt must never block signing. |
| Appointments | `driver_list_appointments`, `admin_create_appointment` (APT-####); Flutter `/profile/support/appointments` |

### Visit booking (Help & Support → Schedule visit)
| Table | Notes |
|-------|-------|
| `visit_departments` | R — Figma RSup/12 keys (hr_services, legal, …). `20260901100100` adds nullable **`branch_id`**: `NULL` = offered at every branch (how all 11 existing rows behave), non-null = that branch only. `key` stays globally unique because it is the FK target for `visit_slots.department_key` and `visit_bookings.department_key`, and the one-active-booking-per (driver, date, department) index is a locked rule. **App must filter the department list by the branch it is booking at** — `branch_id IS NULL OR branch_id = <branch>` — or it will offer a department the server then rejects. |
| `visit_branches` | R — Admin catalog; User App shows Central Tower (no branch picker) |
| `visit_slots` | R — capacity; remaining = capacity − active bookings |
| `visit_bookings` | **W** own rows; code **VIS-#####**; status confirmed / checked_in / completed / no_show / cancelled |
| `visit_bookings.note` | Rider-authored **Purpose** of the visit (what the driver types at booking) |
| `visit_bookings.note_to_rider` | **R** — staff instruction written by Admin (`visits.operate`). Show it on the driver's booking detail; it is not the rider's own note |
| `visit_booking_notes` | Admin-only internal thread — **no driver policy**; never surface in the app |
| Duplicate rule | Unique active `(driver_id, scheduled_date, department_key)` where status ∈ confirmed, checked_in. Error: `duplicate_department_date` — “Already booked for this department on this date.” |
| Admin reschedule | `admin_reschedule_visit` updates `scheduled_date` + `slot_id` **in place** — `booking_code` never changes, so the code the rider already holds stays valid. Refresh the booking detail; the date/slot may move without a new row |
| Branch consistency | `driver_list_visit_slots` hides a slot whose `branch_id` differs from its department's pin; `driver_book_visit` rejects the same mismatch with **`department_not_at_branch`**. Same migration also stops `driver_book_visit` resolving its fallback branch by the hardcoded key `'central_tower'` — it now orders by `visit_branches.is_default`, so renaming or deactivating that branch no longer silently breaks booking. |
| RPCs (live) | `driver_list_visit_slots`, `driver_book_visit`, `driver_cancel_visit` |

Legacy `appointment_slots` / `appointments` remain until Visit Booking fully replaces them in the app.

### `loan_terms` (read only for driver after approve)
- `total_kwd`, `deduction_kwd`, `months`, `installment_remaining`

### `wrong_actions` (read only)
- `action_type`, `severity`, `details`, `occurred_at`

When admin sets `status = verified`, Postgres runs `recalculate_driver_earnings(driver_id, earn_date)` which updates `driver_earnings_daily` and syncs an approved **`earning_credit`** row in `driver_wallet_entries` (idempotent via `source_ref`).

### `driver_earnings_daily` (read only — computational aggregate)
- Per-day: deliveries, base_kwd, incentive_kwd, loan/penalty/reimbursement deductions, net_kwd
- Used for admin previews and KPIs; may be recalculated when deliveries are verified or corrected.

### `driver_wallet_entries` (read only — approved ledger for driver-visible balance)

| Column | Type | Notes |
|--------|------|-------|
| driver_id | uuid | `auth.uid()` for rider |
| earn_date | date | Kuwait calendar day |
| entry_type | enum | `earning_credit` (auto on recalc), `manual_adjustment`, `payout_debit` (future) |
| amount_kwd | numeric | Approved amount for that day/type |
| status | enum | `approved` \| `pending` \| `voided` — driver app reads **`approved` only** |
| source_ref | text | Unique idempotency key, e.g. `earning:{driver_id}:{earn_date}` |
| meta | jsonb | Snapshot of daily breakdown (deliveries, base, incentive, net, etc.) |

**Driver app queries (RLS):**

```typescript
// Approved daily credits for earnings screen / payout balance
const { data } = await supabase
  .from('driver_wallet_entries')
  .select('earn_date, amount_kwd, entry_type, status, meta')
  .eq('driver_id', userId)
  .eq('status', 'approved')
  .order('earn_date', { ascending: false });
```

Sum `amount_kwd` where `entry_type = 'earning_credit'` for “approved earnings this week”. Future payout runs will insert `payout_debit` rows against the same ledger.

**Earnings → Performance Summary (required):** `driver_earnings_daily.deliveries` / `week.deliveries_count` are **verified-only** (payroll). Do **not** use them for “Total Delivery Count”.

**Home → This Week’s Progress Time in:** `week.online_seconds` is `SUM(driver_attendance.online_seconds)` for `kuwait_week_start`..today, plus live elapsed only if the open `driver_sessions` row started today. Do **not** sum `driver_sessions` across the week — leftover `is_online` rows from prior days inflate the total with wall-clock hours.

```sql
select public.driver_get_earnings_summary();
-- { ok, total_deliveries, verified_deliveries, pending_deliveries, rejected_deliveries }
```

`total_deliveries` = lifetime submitted (pending + in_transit + verified + rejected; **excludes cancelled**). Same object is also `driver_get_home_dashboard().performance`. For driver `10085` that is `10` made / `5` verified — summing daily verified rows is what produced the wrong `5`.

Admin RPCs (staff): `get_driver_earnings_detail`, `list_driver_earnings_daily`, `recalculate_earnings_for_range`.

### `driver_earnings_daily` (legacy read — still available)
- Same columns as above; prefer **`driver_wallet_entries`** for driver-facing “approved” balances.

### `hygiene_tasks` + `hygiene_submissions`
- Admin creates task → push to driver → driver uploads photo → admin reviews

### `support_threads` + `support_messages`
- One thread per driver with Control Tower; realtime chat

### `driver_sessions`
- `is_online`, `went_online_at`, `went_offline_at`
- Updated by RPC `driver_set_duty_state(p_is_on_duty, p_is_online)` when the Home duty toggle changes.

### `attendance_logs`
- One row per `(driver_id, log_date)` where `log_date` uses **Asia/Kuwait** calendar date of **check-in**.
- **Check-in / check-out:** the Home **duty toggle ON** upserts today's row (`check_in_at`, `status = present` unless `on_leave`); **toggle OFF** sets `check_out_at` with `check_out_reason = manual`. **Sign out of the active device** also clocks out (`driver_release_device_session` → `_attendance_apply_checkout`, reason `manual`) so work-time stops and the next login is not still Clocked In. A kicked/old device must **not** clock out — only when `p_device_id` matches `drivers.active_device_id`.
- Checkout finds the latest **open** log (`check_in_at` set, `check_out_at` null) — not only “today” — so overnight shifts that span midnight keep hours on the check-in day.
- `check_out_reason`: `manual` | `auto_offline` | `auto_out_of_zone` | `admin` (null until checked out).
- Written by `driver_set_duty_state` (same RPC as sessions) — no separate attendance button in v1.
- **Auto-checkout (server cron):** if the driver stays **on duty** and is continuously **offline** (`driver_sessions.went_offline_at`) **or** continuously **outside assigned zone** (`driver_locations.out_of_zone_since`, maintained from `drivers.zone_id` geometry on location upserts) for `app_settings.attendance_auto_checkout_minutes` (default **45**), RPC `admin_run_attendance_auto_checkout` checks them out with reason `auto_offline` / `auto_out_of_zone`. Returning online or in-zone before the threshold **resets** that timer (no checkout). Cron: `/api/cron/attendance-auto-checkout` every 5 minutes (`CRON_SECRET`).
- **Driver app (MG-GO):** `remoteDutyMonitorProvider` listens to `drivers` realtime/poll via `liveDbRefreshCoordinator`, patches home duty UI off, refreshes dashboard, and shows snackbar for `auto_offline` / `auto_out_of_zone`. Local duty-off / client zone timeout suppress that toast. Client idle outside-zone countdown is **45 minutes** (aligned with server default).
- `zone_compliance`: `inside` | `outside` (geofence reporting — future writer).
- `admin_note`: set when staff corrects a record via admin panel RPC `admin_correct_attendance` (sets `check_out_reason = admin` when checkout is written).
- Driver **SELECT** own rows (`driver_id = auth.uid()`). Admin module: `/attendance` (today / history / problems / analytics).

**Driver read (today's log):**
```sql
select id, log_date, check_in_at, check_out_at, check_out_reason, status, zone_compliance
  from public.attendance_logs
 where driver_id = auth.uid()
   and log_date = (now() at time zone 'Asia/Kuwait')::date;
```

**Duty toggle (check-in/out):**
```sql
select public.driver_set_duty_state(p_is_on_duty := true, p_is_online := true);  -- check in
select public.driver_set_duty_state(p_is_on_duty := false, p_is_online := false); -- check out (manual)
```
Returns full home dashboard payload (`driver_get_home_dashboard()` shape).

**Working hours:** wall-clock `check_out_at - check_in_at` (admin list uses reporting `duty_seconds`). Midnight-spanning shifts are one continuous interval on the check-in `log_date`.

---

## 5. Storage

### Cloudflare R2 (private — admin + linked driver docs)

Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. Server-only uploads; staff read via presigned GET (15 min).

| Prefix | Who writes | Path |
|--------|------------|------|
| `drivers/intakes/{intake_id}/` | Admin panel (Add Driver) | `{doc_type}.{pdf\|png\|jpg\|webp}` |
| `drivers/{driver_id}/` | Link RPC / mobile onboarding | `{doc_type}.{ext}` |
| `partners/{partner_id}/` | Admin panel | `logo.{ext}` |

`driver_documents.file_url` should store the **object key** (e.g. `drivers/{uuid}/license.pdf`), not a public URL. Resolve with presigned GET in admin/mobile as needed.

**Document expiry (2026-06-18):** Admin stores expiry metadata in `document_tracking` (`intake_id` and/or `driver_id`, `doc_type`, `expires_at`, `track_expiry`, `notify_enabled`, `notify_lead_days` default `{30,14,7,1}`). On driver approve, intake rows get `driver_id` set. Notification automations with trigger `document_expiry` match linked drivers when `(expires_at - today)` equals any configured lead day and dispatch in-app + push via Notification Center v2. Mobile: surface expiry in profile/compliance when reading `document_tracking` or mirrored `driver_documents.expires_at` (staff RLS today — add rider read policy when building compliance UI).

Legacy Supabase buckets `driver-intakes` and `partner-logos` are deprecated; migrate with `node scripts/migrate-storage-to-r2.mjs`.

### Supabase Storage (still used for mobile operational uploads)

| Bucket | Driver upload | Path |
|--------|---------------|------|
| delivery-proofs | Yes | `{driver_id}/{uuid}.jpg` |
| fuel-receipts | Yes | `{driver_id}/{request_id}.jpg` |
| hygiene-photos | Yes | `{driver_id}/{task_id}.jpg` |
| support-attachments | Yes | `{thread_id}/{uuid}` |
| request-attachments | Yes (RCM) | `{driver_id}/{request_id}/{file}` — JPEG/PNG/WebP/PDF; metadata in `request_attachments` |

RLS: authenticated user can write only under their `driver_id` prefix where applicable.

---

## 6. Realtime subscriptions

```typescript
// Support chat
supabase.channel(`support:thread:${threadId}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${threadId}` }, handler)

// Duty status (optional)
supabase.channel('driver_sessions').on('postgres_changes', ...)

// Notifications inbox
supabase.channel(`notifications:driver:${driverId}`).on(...)
```

---

## 7. Push notifications (Notification Center v2)

Admin now sends via `notification_campaigns` + `notification_dispatch_items` (FCM provider), not direct inserts to legacy `notifications`.

### FCM data payload (version 2)

Admin dispatch sends FCM with notification title/body plus a flat string `data` map:

```json
{
  "campaign_id": "uuid",
  "payload_version": "2",
  "action_type": "open_screen | open_module | open_record | open_workflow | open_url | custom_payload | silent_update_trigger",
  "action_params": "{\"screen\":\"home\",\"delivery_id\":\"optional-uuid\"}",
  "category": "incentive | reminder | compliance | attendance | salary | emergency | announcement | operations | system_alert",
  "priority": "low | normal | high | critical",
  "screenshot_restricted": "true | false",
  "deep_link": "optional musallam://...",
  "image_url": "optional HTTPS URL for rich push thumbnail (7-day signed URL at send time)",
  "media": "[{\"role\":\"banner|image\",\"type\":\"image\",\"object_key\":\"notifications/assets/...\"}]"
}
```

Parse `action_params` and `media` as JSON on the client. Parse `screenshot_restricted` as a boolean (`"true"` → true). Unknown keys must be ignored for forward compatibility.

`driver_list_notifications` also returns `screenshot_restricted` (boolean) on each inbox item — **prefer the inbox/RPC value over a stale push payload** on next sync.

**Inbox clear / remove (required):** Riders must be able to clear old notifications from the list. Stamp `notification_dispatch_items.dismissed_at` via `driver_dismiss_notifications(p_dispatch_item_ids uuid[] default null)` (`null` = all of that rider’s undismissed rows). Do **not** DELETE dispatch rows — admin analytics stay. List + unread count omit dismissed rows. Fallback: `DELETE /api/driver-app/notifications` with `{ "dispatch_item_ids": uuid[] | omit-for-all }`.

#### Screenshot restriction (sensitive notifications)

Admin stamps `notification_campaigns.screenshot_restricted` at save/dispatch (template default + optional campaign override).

**Interaction with app-wide secure mode:** The driver app may keep a global `FLAG_SECURE` after login (`SecurityGuardController`). Notification detail must still honor the campaign stamp:

| Effective `screenshot_restricted` | While detail open | On close / dispose |
|---|---|---|
| `true` (Force ON / inherit restricted) | `beginSensitiveSession` — keep secure + iOS blur/detect + `screenshot_taken` | `endSensitiveSession` |
| `false` (Force OFF / unrestricted) | `beginAllowScreenshotSession` — **clear** `FLAG_SECURE` temporarily; suppress global capture-blocked UI | `endAllowScreenshotSession` — **restore** global secure |

Do not leave screenshots permanently allowed after Force OFF detail closes. On app resume, skip re-`enable()` of global secure while an allow session is active.

**Local cache (fail-safe):** Persist last known `screenshot_restricted` keyed by `campaign_id` + `dispatch_item_id`. Offline open uses last known. Never treat as unrestricted if last known was restricted. Missing flag on legacy v1 rows → default `false`.

**Android (notification detail Activity / Flutter route):**

```kotlin
// Restricted: ensure FLAG_SECURE on enter; leave global secure as-is on exit.
// Unrestricted / Force OFF: clear FLAG_SECURE on enter; restore on exit
// (global guard may re-apply FLAG_SECURE after allow session ends).
```

`FLAG_SECURE` blocks screenshots and blanks the app-switcher preview for that window.

**iOS (notification detail route only):** iOS cannot block screenshots. Implement:

1. **Screen recording / Capture:** observe `UIScreen.capturedDidChangeNotification` / `UIScreen.main.isCaptured`. When `isCaptured == true`, blur or hide the notification body (and media). Restore when capture ends.
2. **Screenshot detect:** observe `UIApplication.userDidTakeScreenshotNotification`. When fired on a restricted screen, POST client event `screenshot_taken` (see below).
3. **App switcher:** on `willResignActive` / `didEnterBackground` while restricted detail is mounted, obscure the sensitive body (overlay / hide text) so the snapshot is not readable.

Example Flutter/iOS wiring sketch:

```dart
// FLAG_SECURE via a MethodChannel on Android when restricted detail mounts.
// iOS: WidgetsBindingObserver + platform channel for screenshot/capture notifications.
```

**Screenshot event (iOS — required for compliance audit):**

```json
POST /api/notifications/events
{
  "campaign_id": "uuid",
  "dispatch_item_id": "uuid",
  "event_type": "screenshot_taken",
  "event_at": "ISO timestamp",
  "meta": { "app_version": "1.0.0", "platform": "ios" }
}
```

Does not change delivery lifecycle status. Admin sees attempts on the campaign detail page.

### Personalized content (import campaigns)

When admin sends via **Import from spreadsheet** target mode, the campaign stores a shared title/body template with `{{column_name}}` placeholders. At dispatch time each recipient gets personalized strings stored on `notification_dispatch_items`:

| Column | Purpose |
|--------|---------|
| `resolved_title` | Per-driver title after placeholder substitution |
| `resolved_body` | Per-driver body after placeholder substitution |
| `import_row_index` | 0-based row index from the uploaded sheet |
| `import_vars` | JSON object of column → value used for that row |

The driver inbox RPC `driver_list_notifications` returns `COALESCE(dispatch_item.resolved_title, campaign.title)` and the same for body — **the mobile app must display these fields**, not the raw campaign template, when present.

FCM push at send time also uses the resolved title/body per recipient (not the template strings).

**Images / banners**

| Role | Admin UI | Driver app |
|------|----------|------------|
| `banner` | Wide hero on notification detail | Fetch signed read URL after open |
| `image` | Push tray thumbnail | Used in FCM `image_url`; falls back to `banner` if omitted |

To load banner/image inside the app (private R2 storage), call:

`GET /api/driver-app/notification-media?campaignId={uuid}&role=banner|image`

Requires rider session. Returns `{ readUrl, objectKey, role }`. Only allowed when the driver has a row in `notification_dispatch_items` for that campaign.

### Lifecycle states

`draft` → `pending_approval` (when high/critical/emergency/broadcast-to-all) → `scheduled` | `queued` → `processing` → `sent` → `delivered` → `opened` → `clicked` | `failed` | `cancelled` | `expired`

Approval policy (admin): high priority, critical priority, emergency category, or target mode `all` require `notifications.approve` before send.

### Client event ingestion

POST `https://dpdadmin.vercel.app/api/notifications/events` with rider session:

```json
{
  "campaign_id": "uuid",
  "dispatch_item_id": "uuid",
  "event_type": "delivered | opened | clicked | failed | token_invalid | screenshot_taken",
  "event_at": "ISO timestamp",
  "meta": { "app_version": "1.0.0", "platform": "ios|android" }
}
```

Alternatively call RPC `record_notification_client_event(p_campaign_id, p_dispatch_item_id, p_event_type, p_event_at, p_metadata)` as the authenticated rider.

`screenshot_taken` is audit-only (insert into `notification_events`); it does not advance `notification_dispatch_items` status.

### Push token registration

Upsert into `driver_push_tokens` on login/token refresh:

| Column | Value |
|--------|-------|
| `driver_id` | `auth.uid()` |
| `token` | FCM device token |
| `platform` | `ios` \| `android` |
| `is_active` | `true` |

Deactivate stale tokens when FCM returns invalid-registration.

### Firebase client bootstrap

**Driver app uses production only** — project `musallam-delivery-prod`. Native config: `docs/firebase-prod/` (or driver `android/app/src/main/google-services.json`). Runtime fetch:

```
GET https://dpdadmin-prod.vercel.app/api/driver-app/firebase-config?platform=android
```

Response includes `config.projectId`, `config.appId`, `config.apiKey`, `config.messagingSenderId`, plus `serverConfigured` (admin FCM credentials present).

(Ops testing Firebase under `docs/firebase/` / `musallam-delivery-kw` is not a driver-app target.)
### Deep links

| action_type | Behavior |
|-------------|----------|
| `open_screen` | Navigate using `action_params.screen` (+ optional params) |
| `open_module` | Open app module from `action_params.module` |
| `open_record` | Open entity detail from `action_params.record_type` + `record_id` |
| `open_workflow` | Start workflow from `action_params.workflow` |
| `open_url` | External URL from `action_params.url` |
| `custom_payload` | App-defined handler for `action_params` |
| `silent_update_trigger` | Background refresh only; no UI navigation |

Scheme: `musallam://` (configure in app)

---

## 7b. Legacy push section (deprecated)

The block below is superseded by §7 above. Do not implement against the old shape.

### Campaign payload shape (version 1) — deprecated reference

```json
{
  "version": 1,
  "title": "string",
  "body": "string",
  "category": "general | operations | compliance | payroll | alerts",
  "priority": "low | normal | high | broadcast | emergency",
  "action_payload": {
    "action": "open_screen | open_deeplink | open_url | acknowledge",
    "route": "/home",
    "params": {
      "hygiene_task_id": "optional uuid",
      "delivery_id": "optional uuid"
    },
    "deeplink": "optional musallam://..."
  },
  "data_payload": {
    "campaign_id": "uuid",
    "dispatch_item_id": "uuid",
    "source": "admin_notification_center",
    "meta": {}
  }
}
```

### Client ack/open/click event contract — deprecated reference

App must POST/emit these back to backend bridge (or equivalent ingestion endpoint) per dispatch item:

- `acknowledged` when push received in device queue
- `opened` when user opens notification content
- `clicked` when primary action/deeplink is executed

Minimum fields:

```json
{
  "campaign_id": "uuid",
  "dispatch_item_id": "uuid",
  "event_type": "acknowledged | opened | clicked",
  "event_at": "ISO timestamp",
  "meta": {
    "app_version": "string",
    "platform": "ios|android",
    "deeplink": "optional"
  }
}
```

### Deep links — deprecated reference

| action_payload.action | Route/Behavior |
|-----------------------|----------------|
| `open_screen` | use `action_payload.route` |
| `open_deeplink` | use `action_payload.deeplink` |
| `open_url` | external URL in `action_payload.params.url` |
| `acknowledge` | stay in place and emit `clicked` |

Scheme: `musallam://` (configure in app)

---

## 8. Geofencing

`zones` stays the canonical geometry table. Geofence behavior now lives in companion tables:

- `zone_geofence_settings` (1:1 by `zone_id`) with:
  - `geofence_kind`: `inclusion | exclusion`
  - `status`: `active | inactive | draft`
  - alert toggles: `alert_on_entry`, `alert_on_exit`, `alert_on_dwell`, `dwell_time_seconds`
  - assignment + notifications: `assign_to_all_drivers`, `driver_group_label`, `notify_in_app`, `notify_email`, `notify_sms`
- `geofence_events` audit trail (future crossing detection writer): `event_type`, `occurred_at`, location/accuracy, metadata

RLS summary:

- Staff (`is_admin_panel_user()`) can manage/read settings and read events.
- Event writes are currently staff/service driven (mobile client should not assume direct inserts yet).

Realtime:

- `zone_geofence_settings` and `geofence_events` are published on `supabase_realtime`.

Current app behavior:

1. Admin defines zones in `/zones` with `zone_type` + `geometry` (GeoJSON Feature):
   - **polygon:** `{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[lng,lat],...]] } }`
   - **circle:** `{ type: "Feature", geometry: { type: "Point", coordinates: [lng,lat] }, properties: { radiusMeters: 1500 } }`
2. Geofence UI defaults for legacy zones are `inclusion + active + entry/exit alerts enabled`, so older rows render safely even before settings are explicitly saved.
3. Driver assigned `drivers.zone_id`
4. While online, app posts `current_lat/lng` to `drivers` every N seconds
5. Client checks point-in-zone (polygon: `booleanPointInPolygon`; circle: distance ≤ `radiusMeters`); if outside → show countdown banner (Home screen)
6. Server writes `attendance_logs.zone_compliance = outside` for reporting
7. Admin **Outside Zone** tab lists drivers in violation

Shared validation logic (admin): `src/lib/geo/zone-geometry.ts` — mirror in mobile app.

---

## 9. App settings (read at app start + on reconnect)

```sql
select driver_app_title,
       driver_app_logo_url,
       driver_app_splash_url,
       driver_app_icon_url,
       updated_at,
       driver_app_maintenance_mode,
       driver_app_maintenance_message,
       driver_app_login_hint,
       driver_app_delivery_proximity_meters
  from public.app_settings
 where id = 1;
```

- **Anon-readable** via policy `app_settings_public_branding_read` (same row as admin branding).
- When `driver_app_maintenance_mode = true`: render a full-screen maintenance view using `driver_app_maintenance_message`. Block login and in-app actions; allow retry/poll.
- **Separate** from `maintenance_mode` on the same row (that flag gates the **admin panel** only).
- `driver_app_logo_url` / `driver_app_splash_url` / `driver_app_icon_url` are public Supabase Storage URLs under bucket `branding`, paths `driver-app/logo.*`, `driver-app/splash.*`, and `driver-app/icon.*`. Uploads append a `?v=` cache-bust query param.
- **App icon refresh:** subscribe to `app_settings` realtime (row `id = 1`) or poll `updated_at` / compare `driver_app_icon_url` on app resume. When the URL changes, download the new image and update the launcher icon (Expo: `expo-dynamic-app-icon` or platform-specific APIs).
- `driver_app_title` is the mobile app display name (defaults to `Musallam Delivery`). Admin subtitle/login hint remain on `app_subtitle` / `driver_app_login_hint` (configured under Settings → Branding).
- `driver_app_delivery_proximity_meters` (default 500): max meters outside zone boundary or from assigned restaurant to allow Add Delivery. `0` disables the gate. Loaded via `driver_get_delivery_proximity_context()` when opening Add Delivery (includes zone geometry + assigned restaurants).
- `driver_app_sideload_updates_enabled` is **deprecated and forced `false`** — sideload OTA was removed.

### 9a. Distribution: Google Play only (required)

In-app APK install / sideload OTA is **removed**. There are **no Android product flavors** and **no in-app update channels**. Updates ship only via Google Play.

**Driver app must:**

1. Ship **only** through Google Play (single production app / AAB — no `dev`/`prod` flavor split).
2. **Never** declare `REQUEST_INSTALL_PACKAGES`, and never bundle an APK installer / FileProvider install path.
3. Not show in-app update dialogs or download APKs. Admin no longer serves them (`/app-releases` is a tombstone; admin APIs return `sideload_removed`).
4. **Hard-block the app when Android Developer options are enabled** (check at launch and on resume; show a non-dismissible screen with an exit action).
5. Optional adoption ping only: `GET https://dpdadmin-prod.vercel.app/api/driver-app/active-release?platform=android&versionCode=…&versionName=…` with the driver Bearer token. It records the installed version and **always returns `null`** — no `apk_url`. Any legacy `channel` query param is ignored; the DB stores the adoption label `production` for history only (not a product update channel).

---

## 10. Brand / UI

Match admin semantic tokens: `docs/DESIGN_SYSTEM.md` (CSS variables: `primary`, `background`, `muted`, etc.)

- Background cream `#FAF6F2`, accent coral `#EF5B4D`, primary CTA dark `#1A1A1A`
- Status: green Active, coral Suspended/Warning
- Currency: **KWD** with 3 decimal places where needed
- RTL: full Arabic support (`ar`)

Bottom nav (driver app): **Home · Deliveries · Earnings · Vehicle · Profile**

---

## 11. Status flows (admin ↔ app)

### Delivery
`driver submits (pending)` → `admin verifies (verified)` or `rejects (rejected + reason)` → app shows badge

**Active Delivery footer (system nav).** On `/deliveries/active`, bottom actions (**Mark as Delivered**, **Cancel Order**) must sit above the phone system navigation / gesture inset. Prefer `padding: EdgeInsets.only(bottom: 16 + MediaQuery.viewPaddingOf(context).bottom)` (or `SafeArea` with `maintainBottomViewPadding: true`). Do not rely on `MediaQuery.padding.bottom` alone — on Android edge-to-edge it is often `0` while the system bar still overlaps the buttons. Keep tap targets ≥ 48dp.

**Stale pickup auto-cancel.** `driver_create_pickup` raises `active_pickup_exists` while the driver has an
`in_transit` row, so a pickup that never completes blocks every later order. A cron
(`admin_expire_stale_pickups`, every 15 min) cancels `in_transit` rows older than
`app_settings.pickup_auto_cancel_hours` (default 6). The app must tolerate an in-progress pickup
disappearing on refresh — reload active pickup state rather than assuming it persists, and let the
driver re-enter the same order id (cancelled rows are excluded from the duplicate check).

### Request (loan/fuel/leave/complaint)
`driver submits (pending)` → `admin approves/rejects` → app updates list; loan shows repayment terms from `loan_terms`

### Fuel
`pending` → `approved` → `reimbursed` (payroll run — admin marks via earnings)

### Hygiene task
`admin creates task` → `push to driver` → `driver submits photo (pending)` → `admin completes/rejects` → penalty may apply to earnings

---

## 12. How to keep this file updated

When implementing an **admin panel** feature, update this file if you change:

- [ ] Table/column/enum added or renamed
- [ ] RLS policy for driver role
- [ ] Storage bucket or path convention
- [ ] Realtime channel name
- [ ] Push payload or deep-link route
- [ ] New screen on either side

Tag admin PRs: `[admin+app]` in `.cursor/rules/project-architecture.mdc` change log.

---

## 13. Suggested mobile stack (not prescriptive)

- **React Native / Expo** or **Flutter**
- **Supabase JS** client with secure storage for session
- **Mapbox / Google Maps** for zone overlay
- **FCM + APNs** for push (triggered from Notification Center dispatch worker / queue)

---

## 14. Uploads (R2)

Driver images and documents use the **same private R2 bucket** as the admin panel (`dpd-private`). R2 credentials live only in **Vercel env vars** on the admin Next.js app — never in the mobile bundle.

**Base URL:** `https://dpdadmin.vercel.app` (or your deployed admin origin)

**Auth:** `Authorization: Bearer <supabase_access_token>` for the signed-in rider (`profiles.role = 'rider'`, `drivers.id = auth.uid()`).

### Recommended flow (presigned PUT)

1. `POST /api/driver-uploads/presign`  
   Body (JSON): `{ "entityType", "entityId?", "contentType", "filename", "sizeBytes" }`  
   Response: `{ uploadId, uploadUrl, objectKey, expiresAt, requiredHeaders: { "Content-Type": "..." } }`

2. `PUT <uploadUrl>` with raw file bytes and the **exact** `Content-Type` from step 1.

3. `POST /api/driver-uploads/confirm`  
   Body: `{ "uploadId" }`  
   Response: `{ ok: true, objectKey, sizeBytes }`

### Proxy fallback (when direct PUT is blocked)

`POST /api/driver-uploads/proxy` — `multipart/form-data`: `entityType`, optional `entityId`, `file`.

### List my uploads

`GET /api/driver-uploads/mine?limit=50` — returns completed uploads with short-lived `readUrl` (presigned GET).

### Allowed `entityType` values

| entityType | Max size | Content types |
|------------|----------|---------------|
| `driver_doc` | 10 MB | `image/*`, `application/pdf` |
| `driver_selfie` | 5 MB | `image/*` |
| `driver_avatar` | 2 MB | `image/*` |
| `order_proof` | 10 MB | `image/*`, `application/pdf` |
| `login_verification` | 5 MB | `image/*` |

Object keys are server-generated: `drivers/{driverId}/{entityType}/{date}/{uuid}.{ext}`, except `driver_avatar` which uses `driver-avatars/{driverId}/{date}/{uuid}.{ext}`.

Confirm or proxy of `driver_avatar` writes `drivers.avatar_object_key`, `profiles.avatar_url`, and the linked intake `avatar_url`. Still call `driver_update_avatar(p_object_key)` after confirm (idempotent; also validates the key belongs to the caller).

Login identity selfies use `login_verification` after on-device blink liveness. After confirm, the app calls `driver_record_login_verification(p_object_key, p_liveness_passed, p_liveness_method)` to write `driver_login_verifications` (Phase 1 soft liveness — defaults allow old APKs). See **`docs/LOGIN_VERIFICATION_HANDOFF.md`**.

### CORS

Set `DRIVER_APP_ORIGINS` on the admin deployment (comma-separated app origins). Preflight `OPTIONS` is supported on all upload routes.

### Admin visibility

Every completed upload is recorded in `storage_uploads` and shown on **Settings → Cloudflare R2** (filter: Driver app). Admin intake uploads use `uploaded_via = 'admin'`.

---

## 15. Supabase connection

All driver builds use the **DPD production** Supabase project (`eoksxkdssptgyqyywdju`) and admin `https://dpdadmin-prod.vercel.app`. Prefer driver `env/prod.json` / dart-defines:

```env
SUPABASE_URL=https://eoksxkdssptgyqyywdju.supabase.co
SUPABASE_ANON_KEY=<anon key from production project API settings>
ADMIN_API_BASE_URL=https://dpdadmin-prod.vercel.app
```

Never ship `SUPABASE_SERVICE_ROLE_KEY` in the mobile app.
---

## 16. Restaurant delivery geofences (admin-managed)

### What admin manages

Admins create and edit restaurants at `/restaurants/new` and `/restaurants/[id]/edit` (full-page editor). Alongside the existing restaurant fields — partner, zone, name, external merchant ID, **map link**, **latitude/longitude pin**, logo, and status — admins can author any number of **inclusion** and **exclusion** geofences per restaurant. Each geofence is either a **polygon** or **circle**, drawn on the map in the admin panel.

Inclusion geofences define where drivers linked to that restaurant may log deliveries. Exclusion geofences block delivery points inside their shape regardless of inclusion coverage. When a restaurant has no inclusion geofences, proximity enforcement falls back to the existing pin-based radius check around `restaurants.latitude` / `restaurants.longitude`.

### New storage

Table `public.restaurant_geofences`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `restaurant_id` | uuid | FK → `restaurants(id)` ON DELETE CASCADE |
| `kind` | `restaurant_geofence_kind` enum | `inclusion` \| `exclusion` |
| `zone_type` | `zone_geometry_type` enum | `polygon` \| `circle` (reuses zones enum) |
| `geometry` | jsonb | GeoJSON `Feature` — same contract as `zones.geometry` |
| `name` | text | Optional admin label |
| `color` | text | Hex display color (defaults: green inclusion, red exclusion) |
| `created_at`, `updated_at` | timestamptz | Audit timestamps |
| `created_by` | uuid | FK → `profiles(id)` |

Migration: `20260626900000_restaurant_geofences.sql`.

### Existing `restaurants` surface unchanged

Columns `partner_id`, `zone_id`, `name`, `external_merchant_id`, `map_link`, `latitude`, `longitude`, `status`, `logo_url` retain the same meaning, types, and constraints. The pin remains the primary location marker; geofences are additive.

### RLS

- **Staff** (`is_admin_panel_user()`): full read/write on `restaurant_geofences`.
- **Drivers**: SELECT only for rows whose `restaurant_id` appears in `driver_restaurants` for `auth.uid()`.

### Proximity gate (Postgres)

`public.driver_is_within_delivery_range(p_driver_id, p_lat, p_lng, p_proximity_meters)` now evaluates each driver-linked restaurant:

1. If the restaurant has **inclusion** geofences → point must fall inside at least one.
2. If no inclusion geofences → fall back to pin proximity (`ST_DWithin` of `latitude`/`longitude`).
3. If any **exclusion** geofence contains the point → blocked for that restaurant.
4. If no linked restaurant satisfies the above, the existing driver **zone** proximity branch still applies.

`public.driver_create_delivery` continues to call this function; its return contract is unchanged.

### Context RPC payload extension

`public.driver_get_delivery_proximity_context()` returns the existing top-level fields plus, for each linked restaurant in the `restaurants` array, a `geofences` array:

```json
{
  "id": "uuid",
  "kind": "inclusion | exclusion",
  "zone_type": "polygon | circle",
  "geometry": { "type": "Feature", "geometry": { ... }, "properties": { ... } },
  "name": "string | null",
  "color": "#hex"
}
```

No new RPC was added; the existing function's restaurant objects gained the `geofences` field.

---

---

## Ops audit backend contract (2026-07-29)

| RPC / table | Driver app expectation |
|-------------|------------------------|
| `driver_log_security_event(p_event_type, p_severity, p_context)` | Log security events. Accepts `p_event_type = 'zone_timeout_checkout'` with `p_severity = 'warning'`. Context JSON may include `mode` (`idle` \| `return_grace`), `window_seconds`, coordinates, `zone_status`, `outside_since`. Stored in `driver_security_events`. |
| `driver_complete_delivery` / `driver_cancel_delivery` | **Idempotent retry**: if delivery already completed (`pending`/`verified`) or cancelled, returns the existing row instead of raising `invalid_delivery_status`. |
| `driver_create_pickup` / complete / cancel | **Only** the overloads with `p_device_id` remain (pre-device overloads dropped). Always pass `p_device_id`. |
| `driver_release_device_session` | Clears this device row. **When it is the active device**, clocks the driver out (`is_on_duty = false`, close open session + attendance log) so work-time stops. Kicked devices (id ≠ `active_device_id`) only revoke their own session. Profile Sign out must call this **and** `driver_set_duty_state(false, false)` first (`clockOut: true`); device-kick sign-out must not pass `clockOut`. |
| `driver_heartbeat` | Unchanged — `flush_grace_active: true` for ~5 min after device override (via `flush_deadline_at`). |
| `driver_finalize_reconciliation` | Unchanged — accepts flushed rows during override grace. |
| Weekly/monthly incentives | Accrue **once** on period end day (Kuwait week/month end) in `driver_earnings_daily.incentive_kwd`. |
| `driver_has_active_restaurant` | Requires linked restaurant with `status = published` AND `is_active = true`. |

Migration: `20260729100000_ops_audit_backend_fixes.sql`

---

*Last synced: 2026-08-13 — [admin+app] Sign out of the active device clocks the driver out (`driver_release_device_session` + Profile `clockOut: true`) so work-time stops and Clocked In does not survive logout. Migration `20260907160000`.*

*Prior: 2026-08-13 — [admin+app] Home This Week’s Progress Time in uses attendance days in the current Kuwait week (`driver_week_online_seconds`); stale last-week `is_online` sessions are ignored. Migration `20260907140000`.*

*Prior: 2026-08-13 — [admin+app] Archived-driver login shows “Your driver account has been archived” (maps `driver_archived`); do not collapse it into invalid credentials.*

*Prior: 2026-08-08 — [admin+app] Driver app collapsed to single production stack (no Android flavors / no OTA / no update channels); driver targets `dpdadmin-prod` + Supabase `eoksxkdssptgyqyywdju` + Firebase `musallam-delivery-prod` only; Play Store distribution; `/api/driver-app/active-release` always returns `null`; admin App Releases remain tombstoned. Migrations `20260823100000_disable_driver_app_sideload.sql`, `20260823110000_single_release_channel.sql`.*

*Prior: 2026-07-29 — [admin+app] Ops audit: security events RPC, delivery idempotency, device-guard overload cleanup, published restaurant gate, period incentive accrual fix.*

*Prior: 2026-05-26 — [admin+app] Restaurant delivery geofences: `restaurant_geofences` table, full-page admin editor at `/restaurants/[id]/edit`, updated `driver_is_within_delivery_range` and `driver_get_delivery_proximity_context`.*

*Prior: 2026-06-23 — [admin+app] Geofence schema upgrade (`zone_geofence_settings`, `geofence_events`), default settings fallback for legacy zones, realtime publication for geofence tables, and create/edit geofence rule controls.*

*Prior: 2026-06-07 — [admin+app] R2 env-only credentials; storage stats dashboard; driver upload API (`/api/driver-uploads/*`) + `storage_uploads` audit table.*

*Prior: 2026-06-05 — [admin+app] Driver app settings: `driver_app_title`, logo/splash URLs, `driver_app_maintenance_mode` + message. Admin page `/settings/app`. Migration `20260605100000_driver_app_settings.sql`.*

*Prior: 2026-06-04 — [admin+app] Driver codes shortened to exactly 5 digits (`10001`–`99999`). Migration renumbers existing rows; `allocate_driver_code` enforces capacity.*

*Prior: 2026-06-03 — Global sequence + archive (`archived_at`).*

*Prior: 2026-06-02 — Driver app passcode + driver_code/passcode login.*
