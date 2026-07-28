import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { requireSupabaseEnv } from "@/lib/supabase/env";

export function createBearerSupabaseClient(accessToken: string) {
  const { url, key } = requireSupabaseEnv();
  return createClient<Database>(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
