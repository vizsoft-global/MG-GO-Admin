# RCM + Visit Booking — Figma QA matrix (§11)

Source nodes: User `4004:10289` · Admin RCM `3923:25694` · Admin Visit `4539:10327`  
Date: 2026-08-11 · Status: functional pass; visual polish optional

Legend: ✅ ship · 🔶 partial · ⛔ gated (client seed) · — N/A

## 1A User App

| Figma | Route | Visual | Fields | API | Notes |
|-------|-------|--------|--------|-----|-------|
| RSup/01 Help | `/profile/support` | ✅ | ✅ | — | Hub + Action required / Sign / Appointments |
| RSup/02 Leave…07 Complaint | `/requests/new?type=` | 🔶 | ✅ | ✅ | Loan/complaint submit gated empty seeds |
| RSup/08 Submitted | `/submitted` | ✅ | ✅ | ✅ | RCM-#### |
| RSup/09–10 My requests | `/requests` | 🔶 | ✅ | ✅ | Status variants functional |
| RSup/17–20 Clarify | detail | ✅ | ✅ | ✅ | |
| RSup/23 Action required | `/action-required` | ✅ | ✅ | ✅ | |
| RSup/11–16 Visit | `/visits/*` | 🔶 | ✅ | ✅ | Reschedule = cancel+rebook |
| RSup/24–27 E-Sign | `/sign/*` | ✅ | ✅ | ✅ | SIG-#### + pad + notify |
| RSup/28–29 Appointments | `/appointments` | ✅ | ✅ | ✅ | APT-#### list/detail |

## 1B Admin RCM

| Figma | Route | Status |
|-------|-------|--------|
| Overview list + KPIs | `/requests` | ✅ |
| Detail decide | `/requests/[id]` | ✅ |
| Workflows / Categories / Types / Depts / Roles | `/requests/settings/*` | ✅ |
| Asset catalog | `/requests/settings/assets` → `/assets` | ✅ link |
| Reports / Audit / Bulk | `/requests/reports`, settings/audit, import-export | 🔶 CSV export |
| Screenshot settings | `/requests/settings/screenshot` | ✅ |
| ESign hub/sent/list/detail/categories | `/requests/esign/*` | ✅ |

## 1C Admin Visit

| Figma | Route | Status |
|-------|-------|--------|
| List / Calendar / Detail / Reception / Slots / Depts / Branches / Reports | `/visit-bookings/*` | ✅ |

## Locked / gated

- Loan tenure options + complaint categories: **no invented seeds**
- Admin RCM: attention badge only (no admin push)
- Driver notify: `notify_driver_transactional` on decide / visit / esign / appointment
