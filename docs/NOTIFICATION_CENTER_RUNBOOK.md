# Notification Center — Production Rollout Runbook

## Pre-flight

- [ ] Supabase migrations applied (`20260625180000`, `20260626910000`, `20260626920000`)
- [ ] Firebase env vars set on Vercel: `FIREBASE_SERVICE_ACCOUNT_JSON` (or `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`)
- [ ] Firebase apps registered in project `musallam-delivery-kw` (Android/iOS `kw.musallam.delivery`)
- [ ] Driver app loads Firebase via `docs/firebase/*` or `GET /api/driver-app/firebase-config?platform=...`
- [ ] Optional tuning: `NOTIFICATION_APPROVAL_REQUIRED_CATEGORIES`, `NOTIFICATION_SEND_RATE_PER_MINUTE`, `NOTIFICATION_BATCH_SIZE`
- [ ] Cron secret set: `CRON_SECRET` (Vercel cron hits `/api/cron/notifications-dispatch` every 5 minutes)
- [ ] RBAC: `notifications.approve`, `notifications.send`, `notifications.export` assigned to appropriate roles

## Smoke test (staging)

1. Sign in as operator with `notifications.manage` — create draft campaign targeting one test driver.
2. Sign in as approver — approve high-priority or broadcast campaign; verify status moves to `queued` or `scheduled`.
3. Send now — verify `notification_dispatch_runs` + `notification_dispatch_items` rows and FCM delivery (or `firebase_not_configured` skip in dev).
4. Schedule for +10 minutes — verify cron processes due campaigns.
5. Mobile simulator — register token in `driver_push_tokens`, emit `delivered`/`opened` via `/api/notifications/events`.
6. Analytics dashboard — KPIs reflect sent/delivery/open counts.
7. Export — user with `notifications.export` can download CSV via server action.

## Operational controls

| Control | Location |
|---------|----------|
| Global kill switch | `notification_remote_config.global_enabled` |
| Emergency gate | `notification_remote_config.emergency_gate_enabled` |
| Category throttles | `notification_remote_config.category_throttles` JSON |
| Manual worker | Cron route or `processDueNotificationCampaigns` |

## Failure triage

| Symptom | Check |
|---------|-------|
| `approval_required` on send | Campaign needs approver; status must be past `pending_approval` |
| `empty_audience` | Target filters match zero active drivers |
| `firebase_not_configured` | Missing Firebase admin credentials |
| `no_token` on dispatch items | Driver has no row in `driver_push_tokens` |
| Scheduled not firing | Vercel cron + `CRON_SECRET`; campaign `status=scheduled` and `scheduled_for <= now()` |

## Rollback

1. Set `notification_remote_config.global_enabled = false` to halt new sends without code deploy.
2. Cancel in-flight scheduled campaigns via admin detail page.
3. Revert deploy if application regression; schema is additive and backward compatible.

*Last updated: 2026-05-26*
