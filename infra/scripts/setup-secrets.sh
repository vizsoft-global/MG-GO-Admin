#!/usr/bin/env bash
# Interactive helper — sets Pulumi secrets for production stack (nothing is committed).
set -euo pipefail

cd "$(dirname "$0")/.."

STACK="${1:-production}"
pulumi stack select "$STACK" 2>/dev/null || pulumi stack init "$STACK"

prompt_secret() {
  local key="$1"
  local hint="$2"
  echo ""
  echo "→ dpd-infra:${key}  (${hint})"
  read -rsp "  value (hidden): " val
  echo ""
  if [[ -n "$val" ]]; then
    pulumi config set --secret "dpd-infra:${key}" "$val"
  fi
}

echo "Setting secrets for stack: ${STACK}"
echo "Press Enter to skip optional keys."

prompt_secret "supabaseAccessToken" "sbp_... from Supabase Account → Access Tokens"
prompt_secret "supabaseDatabasePassword" "strong password for new prod DB"
prompt_secret "cloudflareApiToken" "R2 + account read (cf token)"
prompt_secret "vercelApiToken" "Vercel → Settings → Tokens"
prompt_secret "gcpBillingAccount" "billingAccounts/XXXX (not always secret)"
prompt_secret "gcpOrgId" "GCP organization id"
prompt_secret "r2AccessKeyId" "R2 S3 API token access key (after bucket created)"
prompt_secret "r2SecretAccessKey" "R2 S3 API token secret"
prompt_secret "supabaseAnonKey" "after fetch-supabase-api-keys.mjs"
prompt_secret "supabasePublishableKey" "after fetch-supabase-api-keys.mjs"
prompt_secret "supabaseServiceRoleKey" "after fetch-supabase-api-keys.mjs"
prompt_secret "googleMapsApiKey" "optional — copy from testing"
prompt_secret "maptilerApiKey" "optional — copy from testing"

echo ""
echo "Done. Run: pulumi preview --stack ${STACK}"
