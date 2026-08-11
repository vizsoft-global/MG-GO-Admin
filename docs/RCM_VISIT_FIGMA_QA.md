# RCM + Visit Booking — Figma QA matrix (§11)

Source: User `4004:10289` · Admin RCM `3923:25694` · Admin Visit `4539:10327`  
Date: 2026-08-11 · **Pin-to-pin executed — NOT 100% PASS**

Legend: column values PASS / FAIL / BLOCKED / N/A · **Result** = overall for that screen.

| Bucket | Count | PASS | FAIL | BLOCKED |
|--------|------:|-----:|-----:|--------:|
| User App | 33 | 8 | 23 | 2 |
| Admin RCM | 31 | 2 | 28 | 1 |
| Admin Visit | 9 | 1 | 8 | 0 |
| **Total** | **73** | **11** | **59** | **3** |

BLOCKED Values (client seeds — do not invent): Loan tenure · Complaint categories.

---

## 1A User App (33)

| Figma Node | Route | Visual | Fields | Values | Rsp | Ix | API | DB | State | Perm | Ntf | Result |
|------------|-------|--------|--------|--------|-----|----|-----|----|-------|------|-----|--------|
| RSup/01 Help | `/profile/support` | FAIL | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| RSup/02 Leave | `…/new?type=leave` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS** |
| RSup/02b Sick | `…sick_leave` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS** |
| RSup/02c Salary | `…salary_justification` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS** |
| RSup/03 Advance | `…loan` | PASS | PASS | **BLOCKED** | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **BLOCKED** |
| RSup/04 Asset | `…asset` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS** |
| RSup/05 Fuel | `…fuel` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS** |
| RSup/06 Document | `…document` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS** |
| RSup/07 Complaint | `…complaint` | PASS | PASS | **BLOCKED** | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **BLOCKED** |
| RSup/08 Submitted | `/submitted` | PASS | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | N/A | **PASS** |
| RSup/09 My Requests | `/requests` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| RSup/10 Detail | `/requests/:id` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| RSup/10b Ack Loan | detail ack | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | **FAIL** |
| RSup/10c Ack Asset | detail ack | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | **FAIL** |
| RSup/10d Ack Sick | detail ack | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | **FAIL** |
| RSup/10e Ack Confirm | detail ack | FAIL | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/11 Tower Intro | visits/book | FAIL | FAIL | PASS | PASS | FAIL | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| RSup/12 Tower Reason | book step0 | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/13 Tower Date | book step1 | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/14 Tower Review | book step2 | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/15 Visit Booked | book step3 | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/16 My Visits | `/visits` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| RSup/17 Pending admin | detail variant | FAIL | FAIL | FAIL | N/A | FAIL | FAIL | FAIL | FAIL | PASS | FAIL | **FAIL** |
| RSup/18 Submitted admin | detail variant | FAIL | FAIL | FAIL | N/A | FAIL | FAIL | FAIL | FAIL | PASS | FAIL | **FAIL** |
| RSup/19 Overdue | detail variant | FAIL | FAIL | FAIL | N/A | FAIL | FAIL | FAIL | FAIL | PASS | FAIL | **FAIL** |
| RSup/20 Clarify | detail clarify | FAIL | FAIL | FAIL | PASS | PARTIAL | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| RSup/23 Action Required | `/action-required` | FAIL | FAIL | FAIL | PASS | FAIL | FAIL | FAIL | PARTIAL | PASS | PARTIAL | **FAIL** |
| RSup/24 Sign Inbox | `/sign` | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| RSup/25 Sign Viewer | `/sign/:id` | PASS | PASS | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| RSup/26 Sign Capture | capture | FAIL | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/27 Sign Confirmed | confirmed | FAIL | FAIL | PASS | PASS | FAIL | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| RSup/28 Appt Inbox | `/appointments` | FAIL | FAIL | FAIL | PASS | FAIL | FAIL | FAIL | FAIL | PASS | PASS | **FAIL** |
| RSup/29 Appt Added | `/appointments/:id` | FAIL | FAIL | FAIL | PASS | FAIL | FAIL | FAIL | FAIL | PASS | FAIL | **FAIL** |

---

## 1B Admin RCM (31)

| Figma Node | Route | Visual | Fields | Values | Rsp | Ix | API | DB | State | Perm | Ntf | Result |
|------------|-------|--------|--------|--------|-----|----|-----|----|-------|------|-----|--------|
| 00-Hub-Grid | `/requests` | FAIL | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| 01-Overview-List | `/requests/overview` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS badge | **FAIL** |
| 02-Request-Detail | `/requests/[id]` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| Drawer Leave…Sick (8) | — typed drawers | FAIL | FAIL | FAIL/BLOCKED | FAIL | FAIL | N/A | N/A | FAIL | N/A | N/A | **FAIL**×7 + **BLOCKED** Advance Values |
| 05-Workflow | `/requests/settings/workflows` | FAIL | PARTIAL | PARTIAL | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| 06-Categories | `/requests/settings/categories` | FAIL | PASS | **BLOCKED** | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **BLOCKED** |
| 06b Types | `/requests/settings/types` | FAIL | FAIL | FAIL | PASS | FAIL | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| 07 Assets | `/requests/settings/assets` | FAIL | FAIL | FAIL | PASS | FAIL | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| 08 Depts + drawers | `/requests/settings/departments` | FAIL | PARTIAL | PARTIAL | PASS | PARTIAL | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| 09 Reports | `/requests/reports` | FAIL | FAIL | FAIL | PASS | FAIL | FAIL | N/A | PASS | PASS | N/A | **FAIL** |
| 10 Audit | `/requests/settings/audit` | FAIL | PARTIAL | PARTIAL | PASS | PARTIAL | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| 11 Bulk | `/requests/import-export` | FAIL | FAIL | FAIL | PASS | FAIL | PARTIAL | PARTIAL | PASS | PASS | N/A | **FAIL** |
| 12 Settings Home | `/requests/settings` | FAIL | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| 13 Roles | `/requests/settings/roles` | FAIL | FAIL | FAIL | PASS | FAIL | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| 14 Screenshot | `/requests/settings/screenshot` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| Status conventions | tokens | FAIL | FAIL | FAIL | N/A | FAIL | N/A | PARTIAL | FAIL | N/A | N/A | **FAIL** |
| ESign 00–04 | `/requests/esign/*` | FAIL | PARTIAL | PARTIAL | PASS | PASS | PASS | PASS | PASS | PASS | PASS driver | **FAIL**×5 |

*(Notification for Admin rows: PASS = no Admin push/campaign; attention badge DB path verified on Overview.)*

---

## 1C Admin Visit (9)

| Figma Node | Route | Visual | Fields | Values | Rsp | Ix | API | DB | State | Perm | Ntf | Result |
|------------|-------|--------|--------|--------|-----|----|-----|----|-------|------|-----|--------|
| VB/00 Hub | `/visit-bookings` | FAIL | PASS | PASS | PASS | PASS | N/A | N/A | PASS | PASS | N/A | **FAIL** |
| VB/01 All Visits | `/visit-bookings/all` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| VB/02 Calendar | `/visit-bookings/calendar` | FAIL | FAIL | FAIL | PASS | FAIL | PARTIAL | PASS | PASS | PASS | N/A | **FAIL** |
| VB/03 Detail | `/visit-bookings/[id]` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| VB/04 Reception | `/visit-bookings/reception` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **FAIL** |
| VB/05 Slots | `/visit-bookings/slots` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **PASS*** |
| VB/06 Depts | `/visit-bookings/departments` | FAIL | PARTIAL | PARTIAL | PASS | PARTIAL | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| VB/07 Branches | `/visit-bookings/branches` | FAIL | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | N/A | **FAIL** |
| VB/08 Reports | `/visit-bookings/reports` | FAIL | PARTIAL | PARTIAL | PASS | PARTIAL | PARTIAL | PASS | PASS | PASS | N/A | **FAIL** |

\*Slots Result marked PASS for API/DB/Fields/Ix functional match; Visual still FAIL vs Figma chrome — overall kept **FAIL** in summary counts above if Visual required. Re-score: Visual FAIL ⇒ Result **FAIL**. Adjusting: VB/05 Result = **FAIL**. Recalc: Admin Visit PASS = **1** only if hub functional-only — keep **0 PASS** for Visit if Visual mandatory.

**Corrected Visit PASS = 0** (Visual FAIL on all). Totals: PASS **10** · FAIL **60** · BLOCKED **3**.

---

## Locked rules verification

| Rule | Status |
|------|--------|
| Leave Submitted→RM→HR→Payroll | PASS (seed) |
| Visit duplicate same dept+date | PASS (RPC+index) |
| Visit Head Office / Operator RBAC | PASS |
| KPI §10 + full date presets | PASS (code) |
| Admin no push / attention badge | PASS |
| Loan/complaint seeds empty | PASS (gated) |

## Remaining client confirmations

1. Loan tenure options list  
2. Complaint category seed list  

## Figma compliance status

**NOT Figma-complete.** Functional scaffold + locked business rules are in place; pin-to-pin Visual fails on most Admin screens and many User chrome screens. Do not claim §11 complete as PASS.
