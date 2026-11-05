# Firebase Account Transfer — Option A Runbook

Moving full ownership of the Firebase / GCP project `musallam-delivery-prod` (project number `579224507592`) to a different Google account, **without creating a new project and without changing any application code**.

---

## 1. What "transfer" actually means

Google Cloud has no project-transfer button. A project is a fixed object; only two things can change about who controls it:

1. **The IAM policy** — which Google accounts hold which roles. `roles/owner` is real ownership.
2. **The billing account link** — whose payment method is charged.

Everything else — project id, project number, Firestore data, Auth users, Cloud Functions URLs, API keys, FCM sender id — stays exactly as it is.

So "moving to another Google account" is: grant Owner to the new account, re-link billing, rotate credentials, then demote the old account.

### Why Option A and not Option C

Option C (a brand-new Firebase project) is a different project with a different number. That forces a full data export/import, a staff password reset (Firebase-managed password hashes cannot be exported), a rebuilt Android app with a new `google-services.json`, a new Play Store release, and ~1,200 rider push tokens becoming unreachable until every phone upgrades. Option A avoids all of it.

---

## 2. What does NOT change under Option A

| Item | Why it matters |
|---|---|
| Project id and number (`579224507592`) | The FCM sender id is derived from the project number, so **no push token is invalidated** |
| Firestore data, indexes, TTL overrides | No export/import required |
| Firebase Auth users and custom claims | Staff session-cookie audience is unchanged — **no forced logout** |
| Cloud Functions URLs (`me-central1-…cloudfunctions.net`) | Worker, crons and the admin panel keep calling the same endpoints |
| Service account email and every API key | Nothing to re-issue except the ones you deliberately rotate |
| Vercel environment, Cloudflare Worker config, `.firebaserc`, `infra/` | **Zero code change in this repository** |
| Cloudflare R2 (`dpd-private-prod`, `dpd-gps-prod`) | Unrelated to Firebase; untouched |
| Play Store listing and rider APKs | No release needed |

Option A is a permissions, billing and credentials operation. It is not a migration.

---

## 3. Prerequisites

| Check | Consequence if missing |
|---|---|
| New Google account is ready (personal or Workspace) | — |
| You currently hold **Owner** on the project | Only an owner may grant Owner |
| You hold **Billing Account Administrator** on the target billing account | `billing.resourceAssociations.create` is denied |
| The target billing account already has a **payment method** | The relink fails without one |
| Workspace domain-restricted sharing permits the principal you are adding | Cross-domain `add-iam-policy-binding` is refused |
| The old account's 2FA recovery codes are saved | The original creator account cannot be recovered once locked out |
| The current billing account ID is recorded | Needed for rollback |

> Do not delete the original creator account. Keep it as Viewer with an Essential Contact on it — Google still treats it specially for recovery.

---

## 4. Phase 1 — Snapshot for rollback

Run as the **current** owner.

```powershell
gcloud auth login
gcloud config set project musallam-delivery-prod
gcloud projects get-iam-policy musallam-delivery-prod --format=json > iam-before.json
gcloud beta billing projects describe musallam-delivery-prod
```

Record `billingAccountName` and confirm `billingEnabled: true`. `iam-before.json` is the only exact rollback reference — keep it outside the repository.

Also capture the inventory while access is still known-good:

```powershell
firebase functions:list      > functions-before.txt
firebase firestore:indexes   > indexes-before.txt
firebase auth:export staff-before.json
```

### Pulumi state

The infrastructure stack in `infra/` reads its project id from `infra/Pulumi.production.yaml` (`dpd-infra:gcpProjectId`, default `musallam-delivery-prod`). Option A does not change that value. Confirm the stack secrets still resolve for the new account before any `pulumi up`:

```powershell
cd infra
pulumi stack select production
pulumi config --show-secrets
```

---

## 5. Phase 2 — Grant Owner to the new account

```powershell
gcloud projects add-iam-policy-binding musallam-delivery-prod `
  --member="user:NEW_OWNER@example.com" `
  --role="roles/owner"
```

Owner, not Editor. `firebase deploy --only functions` needs Cloud Run, Service Usage, IAM, Artifact Registry and Secret Manager together; Editor alone fails partway through a deploy with `PERMISSION_DENIED`.

Verify both accounts appear under `roles/owner`:

```powershell
gcloud projects get-iam-policy musallam-delivery-prod `
  --format="table(bindings.role,bindings.members)"
```

---

## 6. Phase 3 — Billing

A billing account belongs to a Google **payments profile** and cannot be transferred between Google accounts. Only the project's link can move, which unlinks the old account. No money is transferred.

### Choose one

**A1 — keep the existing billing account, swap the payment method.**
Preserves invoice history, promotional credits and any Committed Use Discounts.

Console → Billing → Account management:
1. Add the new owner's card as a payment method.
2. Set it as default.
3. Remove the old card.
4. Add the new owner as `roles/billing.admin` on that billing account.

**A2 — create a new billing account and relink the project.**
Clean legal ownership, but credits, CUD and history start from zero.

```powershell
gcloud beta billing accounts list
gcloud beta billing projects link musallam-delivery-prod `
  --billing-account=NEW_BILLING_ID
gcloud beta billing projects describe musallam-delivery-prod
```

Confirm `billingEnabled: true` afterwards.

### What happens to the money either way

| Item | Outcome |
|---|---|
| Usage accrued this cycle | Billed on the **old** billing account's next invoice |
| Issued invoices (paid or unpaid) | Remain on the old account permanently |
| Prepaid, promotional or free-trial credits | Bound to the old account — **lost**, not moved |
| Committed Use Discounts | Bound to the old account — **lost** |
| Payment method | Must be added fresh to the new billing account |
| Budget alerts and spend notifications | Not carried over — recreate them |
| Tax documents and GST invoices | Remain on the old account |

### Timing

Switch on the **1st of a month**. A mid-month relink produces prorated invoices across two billing accounts, which makes reconciliation painful and hides anomalies.

Do not close the old billing account until one full invoice cycle has passed.

---

## 7. Phase 4 — Essential Contacts

Google sends suspension, quota and outage notices to Essential Contacts, not to the project's IAM owners.

```powershell
gcloud essentialcontacts contacts create `
  --project=musallam-delivery-prod `
  --email=NEW_OWNER@example.com `
  --language=en `
  --notification-category=ALL
```

Remove the old contact only after the new one is confirmed receiving mail.

---

## 8. Phase 5 — Prove the new account has full access

Run as the new owner, in a fresh shell.

```powershell
gcloud auth login
gcloud config set project musallam-delivery-prod
gcloud projects describe musallam-delivery-prod
firebase login:add
firebase use musallam-delivery-prod
firebase projects:list
firebase functions:list
firebase deploy --only firestore:rules
```

`firebase functions:list` should return roughly two hundred functions in `me-central1`. The rules deploy is an intentional no-op: if it succeeds, write access is proven. If it fails, return to Phase 2 — do not proceed to credential rotation.

---

## 9. Phase 6 — Rotate credentials

Transferring ownership without rotating leaves the old account fully functional through cached keys. This phase is the actual security work.

### 9.1 Admin SDK key

```powershell
gcloud iam service-accounts keys list `
  --iam-account=firebase-adminsdk-xxxxx@musallam-delivery-prod.iam.gserviceaccount.com
```

Create a new key, update Vercel `FIREBASE_SERVICE_ACCOUNT_JSON` (or `FIREBASE_CLIENT_EMAIL` plus `FIREBASE_PRIVATE_KEY`), redeploy, verify a production write succeeds, and only then delete the old key.

### 9.2 Functions secrets

These apply on the next functions deploy, not immediately.

```powershell
firebase functions:secrets:set WORKER_SHARED_SECRET
firebase functions:secrets:set SERVICE_ODOMETER_APP_SECRET
```

### 9.3 Cloudflare Worker

`infra/workers/dpd-live` calls the functions base URL with an `X-Worker-Secret` header validated against `WORKER_SHARED_SECRET`. Rotate both sides in the same window or the live map stops updating.

```powershell
npx wrangler secret put WORKER_SHARED_SECRET --config infra/workers/dpd-live/wrangler.jsonc
```

### 9.4 Bites cross-project grant

`functions/src/core/bites.ts` documents that the delivery project's runtime service account needs `roles/datastore.user` on the Bites project. Without it every milestone write returns `PERMISSION_DENIED` and the customer app stalls on "Preparing". Confirm the grant still exists after rotation.

### 9.5 Vercel

Rotating `CRON_SECRET` requires a redeploy so the crons defined in `vercel.json` pick it up. The project's own Firebase env vars do not change under Option A.

### 9.6 Confirm nothing in the repository must change

Option A leaves all of these valid as-is:

`.firebaserc`, `firebase.json`, `functions/src/core/fs.ts`, `src/lib/firebase/admin.ts`, `src/lib/firebase/db.ts`, `infra/workers/dpd-live/wrangler.jsonc`, `infra/workers/dpd-live/src/env.ts`, `infra/config.ts`, `infra/Pulumi.production.yaml`, `docs/firebase-prod/*`, `.env.example`.

---

## 10. Phase 7 — Demote the old account

Wait until Phase 5 and Phase 6 are both verified. Then downgrade rather than remove outright:

```powershell
gcloud projects add-iam-policy-binding musallam-delivery-prod `
  --member="user:OLD_OWNER@example.com" --role="roles/viewer"
gcloud projects remove-iam-policy-binding musallam-delivery-prod `
  --member="user:OLD_OWNER@example.com" --role="roles/owner"
```

Keep Viewer for fourteen days so anything overlooked is still recoverable, then remove it entirely. Never remove the last owner, and never remove both owners in the same change.

---

## 11. Phase 8 — Verification

```powershell
firebase functions:list
firebase firestore:indexes
firebase auth:export staff-after.json
```

Every composite index must report `READY`; the staff export count and `customAttributes` must match the Phase 1 snapshot.

Then exercise the running system in this order, because each step proves a different layer:

1. Staff login at `dpdadmin-prod.vercel.app` — the sidebar renders, which proves `admin_permissions` and the custom claims survived.
2. `/drivers` loads — Firestore read path.
3. One callable write — proves the `allUsers → roles/run.invoker` binding and the new service account.
4. Rider app login by employee id and passcode — proves Auth was untouched.
5. One FCM push — proves sender id `579224507592` and the token collection are intact.

---

## 12. Rollback

| Failure point | Action |
|---|---|
| Anything breaks after Phase 2 | `gcloud projects set-iam-policy musallam-delivery-prod iam-before.json` |
| Billing relink caused an unexpected charge | Re-link the recorded old billing account id |
| Deploy fails for the new account | A permission is missing from the Owner grant — compare policies. Do **not** remove the old owner yet |
| New secret breaks the live map | Restore the previous `WORKER_SHARED_SECRET` on both the Worker and the functions |

---

## 13. Checklist

- [ ] `iam-before.json`, `functions-before.txt`, `indexes-before.txt`, `staff-before.json` captured
- [ ] Current billing account id recorded
- [ ] New account holds `roles/owner` and is visible in the policy
- [ ] Billing decided (A1 keep account, or A2 relink) and confirmed `billingEnabled: true`
- [ ] Budget alerts recreated on the new billing account
- [ ] Essential Contact created for the new account
- [ ] `firebase deploy --only firestore:rules` succeeds as the new account
- [ ] Admin SDK key rotated, Vercel updated, production write verified, old key deleted
- [ ] `WORKER_SHARED_SECRET` rotated in Secret Manager **and** the Cloudflare Worker
- [ ] `SERVICE_ODOMETER_APP_SECRET` re-set
- [ ] Bites `roles/datastore.user` grant confirmed
- [ ] Staff login, driver list, callable write, rider login, FCM push all verified
- [ ] Old account demoted to Viewer and left for fourteen days

---

## 14. Timeline

| Phase | Effort |
|---|---|
| Snapshots and prerequisites | 30 minutes |
| IAM grant and billing | 30 to 45 minutes |
| Access verification | 20 minutes |
| Credential rotation | 1 to 2 hours |
| Demotion and passive monitoring | 14 days, unattended |

Total hands-on time is roughly half a working day. Downtime is zero, code changes are zero, and no application release is required.
