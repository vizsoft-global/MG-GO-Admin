/** Shared Supabase env — prefer JWT anon key for reliable browser auth refresh. */
export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function requireSupabaseEnv(): { url: string; key: string } {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
  }
  return { url, key };
}
