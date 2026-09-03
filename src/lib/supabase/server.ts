import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { requireSupabaseEnv } from "@/lib/supabase/env";
import { createTimeoutFetch } from "@/lib/supabase/deadline";

export async function createClient(options?: { timeoutMs?: number }) {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

  return createServerClient<Database>(url, key, {
    // Opt-in: auth and settings sit on every paint. Reports and mutations stay
    // uncapped so a year-to-date RPC cannot be aborted by a layout timeout.
    ...(options?.timeoutMs
      ? { global: { fetch: createTimeoutFetch(options.timeoutMs) } }
      : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component without mutable cookies
        }
      },
    },
  });
}
