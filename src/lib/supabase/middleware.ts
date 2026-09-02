import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { settledWithin, SUPABASE_DEADLINE_MS } from "@/lib/async/settled-within";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function updateSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next({ request }),
): Promise<{ response: NextResponse; user: User | null }> {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    return { response, user: null };
  }

  const supabase = createServerClient<Database>(url, key, {
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

  const auth = await settledWithin(supabase.auth.getUser(), SUPABASE_DEADLINE_MS);
  return { response, user: auth.ok ? auth.value.data.user : null };
}
