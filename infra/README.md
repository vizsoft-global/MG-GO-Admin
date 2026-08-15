# DPD infrastructure (Pulumi)

**Production only.** Use the `production` stack. The old `testing` stack (`ytfmsgckjatiserpgdbz` / `dpdadmin` / `dpd-private` / `musallam-delivery-kw`) is retired — do not select, preview, or update it.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/) + Pulumi Cloud login
- Node.js 20+
- Supabase CLI (`supabase`)
- API tokens (see `scripts/setup-secrets.sh`)

## Quick start

```bash
cd dpdadmin/infra
npm install

# Production — set secrets first
bash scripts/setup-secrets.sh production
pulumi stack select production
pulumi preview
pulumi up   # or use Pulumi Neo (see below)
```

## After first `pulumi up` (production)

1. Note `supabaseProjectRef` from stack outputs.
2. `SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/replicate-supabase.sh <project_ref>`
3. `SUPABASE_ACCESS_TOKEN=sbp_... node scripts/fetch-supabase-api-keys.mjs <project_ref>`
4. Set `supabaseAnonKey`, `supabasePublishableKey`, `supabaseServiceRoleKey` secrets.
5. Create R2 S3 API token in Cloudflare (bucket `dpd-private-prod`); set `r2AccessKeyId` / `r2SecretAccessKey`.
6. `pulumi up` again to refresh Vercel env vars.
7. From `dpdadmin/`: `vercel link` to `dpdadmin-prod` then `vercel deploy --prod`.

## Pulumi Neo (MCP)

Push branch `infra/pulumi-two-env`, then in Cursor use **neo-bridge** with:

- Repository: `Vizsoft/dpdadmin`
- Stack: `production` in project `dpd-infra`

Neo will preview/apply; approve explicitly when prompted.

## Env var contract

Production Vercel env vars mirror [`../.env.example`](../.env.example). See `components/env-contract.ts`.

## Firebase production apps

New GCP project (`musallam-delivery-prod` by default) registers Android/iOS/Web apps with **new app IDs**. Update mobile builds and [`../docs/DRIVER_APP_HANDOFF.md`](../docs/DRIVER_APP_HANDOFF.md) after deploy.

Regenerate mobile config:

```bash
firebase apps:sdkconfig ANDROID <android_app_id> -o docs/firebase-prod/google-services.json --project musallam-delivery-prod
firebase apps:sdkconfig IOS <ios_app_id> -o docs/firebase-prod/GoogleService-Info.plist --project musallam-delivery-prod
```

## Secrets (never commit)

| Config key | Source |
|------------|--------|
| `supabaseAccessToken` | Supabase dashboard |
| `supabaseDatabasePassword` | You choose (new project) |
| `cloudflareApiToken` | Cloudflare API tokens |
| `vercelApiToken` | Vercel |
| `gcpBillingAccount` / `gcpOrgId` | GCP console |
| `r2AccessKeyId` / `r2SecretAccessKey` | R2 → Manage API tokens |
| `supabaseAnonKey` etc. | `fetch-supabase-api-keys.mjs` |
