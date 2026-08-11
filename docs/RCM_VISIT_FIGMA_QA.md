# RCM + Visit Booking — Figma QA matrix (§11)

Source: User `4004:10289` · Admin RCM `3923:25694` · Admin Visit `4539:10327`  
Date: 2026-08-11 · **Pin-to-pin executed — Figma-complete NOT READY**

Canonical detailed rows: plan `rcm_visit_booking_d61aff20.plan.md` §11.

| Result | Count |
|--------|------:|
| PASS | **23** |
| FAIL | **44** |
| BLOCKED | **6** |
| PENDING | **0** |
| **Total** | **73** |
| Compliance | **31.5%** (23/73) |

## BLOCKED (client confirmation — do not invent)

1. RSup/03 Advance — loan tenure Values  
2. RSup/07 Complaint — category Values  
3. RSup/29 Appointment detail — Accept/Reject/Propose RPC missing  
4. Admin Drawer Complaint — category Values  
5. Admin Drawer Advance — tenure Values  
6. Admin 06-Complaint-Categories — seed Values  

## Top FAIL themes

- Admin Visual density vs Figma (hubs, drawers chrome, calendar grid, reports/bulk/roles)  
- Flutter ack 10b–10d structured amount fields (DB schema gap)  
- Tower intro hours (no schema)  
- Sign capture/confirmed chrome; Sign viewer Decline  

## Locked rules verified

Leave seed · Visit duplicate · Visit RBAC · KPI · Admin attention badge (no push) · Gated seeds  

## Fixes this QA pass

- Flutter: hub, visit wizard 11–15, My Requests banner, Action Required mix, ack confirm screen, forms polish  
- Admin: typed request drawer with Figma §2 field keys; overview status filter; drawer i18n  
