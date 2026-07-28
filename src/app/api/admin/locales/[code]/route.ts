import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as {
      enabled?: boolean;
      is_default?: boolean;
    };
    const supabase = await requireSuperAdmin();

    if (body.is_default) {
      await supabase.from("locales").update({ is_default: false }).neq("code", code);
    }

    const patch: {
      updated_at: string;
      enabled?: boolean;
      is_default?: boolean;
    } = { updated_at: new Date().toISOString() };
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.is_default) patch.is_default = true;

    const { error } = await supabase.from("locales").update(patch).eq("code", code);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
