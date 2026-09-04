import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { settledWithin, SUPABASE_DEADLINE_MS } from "@/lib/async/settled-within";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { probeUser, type AuthProbe } from "@/lib/supabase/auth-probe";
import {
  createTimeoutFetch,
  MIDDLEWARE_AUTH_BUDGET_MS,
  MIDDLEWARE_QUERY_BUDGET_MS,
} from "@/lib/supabase/deadline";

export type SessionContext = {
  response: NextResponse;
  /** Null when Supabase env vars are absent. */
  supabase: ReturnType<typeof createServerClient<Database>> | null;
  probe: AuthProbe;
};

export async function updateSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next({ request }),
<<<<<<< HEAD
): Promise<{ response: NextResponse; user: User | null }> {
=======
): Promise<SessionContext> {
>>>>>>> 8ecba4353e6057c616ca98d9091c2d89e8fa8d5a
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
<<<<<<< HEAD
    return { response, user: null };
=======
    return { response, supabase: null, probe: { user: null, unavailable: false } };
>>>>>>> 8ecba4353e6057c616ca98d9091c2d89e8fa8d5a
  }

  const supabase = createServerClient<Database>(url, key, {
    // Every call this client makes is on the proxy's 25s budget, so none of
    // them may hang. The cap is ~20x a healthy round trip and never fires in
    // normal operation.
    global: {
      fetch: createTimeoutFetch(
        Math.max(MIDDLEWARE_AUTH_BUDGET_MS, MIDDLEWARE_QUERY_BUDGET_MS),
      ),
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

<<<<<<< HEAD
  const auth = await settledWithin(supabase.auth.getUser(), SUPABASE_DEADLINE_MS);
  return { response, user: auth.ok ? auth.value.data.user : null };
=======
  // Refreshing the session and identifying the caller are the same round trip;
  // the result is handed back so the proxy does not repeat it.
  const probe = await probeUser(supabase, { timeoutMs: MIDDLEWARE_AUTH_BUDGET_MS });

  return { response, supabase, probe };
>>>>>>> 8ecba4353e6057c616ca98d9091c2d89e8fa8d5a
}
