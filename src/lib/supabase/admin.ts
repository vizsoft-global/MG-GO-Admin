import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseUrl } from "@/lib/supabase/env";

export function getServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createAdminClient() {
  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL for admin operations",
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
