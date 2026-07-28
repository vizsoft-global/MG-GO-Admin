import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { requireSupabaseEnv } from "@/lib/supabase/env";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Single browser Supabase client — avoids multiple auth refresh loops that cause
 * "Failed to fetch" noise in the console.
 */
export function createClient() {
  if (browserClient) {
    return browserClient;
  }

  const { url, key } = requireSupabaseEnv();
  browserClient = createBrowserClient<Database>(url, key);
  return browserClient;
}
