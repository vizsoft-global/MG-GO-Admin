#!/usr/bin/env bash
# Replicate schema (114 migrations, no data) + edge function to a new Supabase project.
# Usage (from dpdadmin/infra): bash scripts/replicate-supabase.sh <project_ref>
set -euo pipefail

PROJECT_REF="${1:-}"
if [[ -z "$PROJECT_REF" ]]; then
  echo "Usage: bash scripts/replicate-supabase.sh <supabase_project_ref>" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is required (sbp_... from Supabase dashboard)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Linking Supabase project ${PROJECT_REF}"
supabase link --project-ref "$PROJECT_REF" --yes

echo "==> Waiting for project to accept migrations (up to 10 min)"
for i in $(seq 1 60); do
  if supabase projects list 2>/dev/null | grep -q "$PROJECT_REF"; then
    if yes | supabase db push 2>/dev/null; then
      echo "==> Migrations applied"
      break
    fi
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "Timed out waiting for db push. Retry: cd dpdadmin && yes | npx supabase db push" >&2
    exit 1
  fi
  echo "   attempt $i/60 — project may still be provisioning..."
  sleep 10
done

echo "==> Deploying edge function driver-passcode-login"
supabase functions deploy driver-passcode-login --project-ref "$PROJECT_REF"

echo "==> Done. Schema replicated with zero seed data."
echo "    Fetch API keys: node infra/scripts/fetch-supabase-api-keys.mjs ${PROJECT_REF}"
