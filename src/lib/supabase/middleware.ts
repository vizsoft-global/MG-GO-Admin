import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function updateSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next({ request }),
) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    return response;
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

  try {
    await supabase.auth.getUser();
  } catch {
    // Network blip during edge refresh — don't block the request
  }
  return response;
}
