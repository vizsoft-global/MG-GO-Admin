import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTranslationStatsForLocale } from "@/lib/i18n/locales-server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("admin_roles(is_super_admin)")
    .eq("id", user.id)
    .single();

  const isSuperAdmin =
    (profile as { admin_roles: { is_super_admin: boolean } | null } | null)
      ?.admin_roles?.is_super_admin === true;

  if (!isSuperAdmin) throw new Error("Forbidden");
  return supabase;
}

export async function GET() {
  try {
    const supabase = await requireSuperAdmin();
    const { data, error } = await supabase
      .from("locales")
      .select("*")
      .order("is_default", { ascending: false })
      .order("code");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const enriched = await Promise.all(
      (data ?? []).map(async (l) => {
        const stats = await getTranslationStatsForLocale(l.code);
        return {
          ...l,
          translation_count: stats.total,
          needs_review_count: stats.needsReview,
        };
      }),
    );

    return NextResponse.json({ locales: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
