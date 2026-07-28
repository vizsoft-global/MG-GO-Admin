import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import {
  flattenMessages,
  unflattenMessages,
} from "@/lib/i18n/message-keys";

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
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  try {
    await requireSuperAdmin();
    const { locale } = await params;
    const enPath = path.join(process.cwd(), "src/messages", "en.json");
    const localePath = path.join(process.cwd(), "src/messages", `${locale}.json`);

    const source = JSON.parse(await readFile(enPath, "utf8"));
    let targetFlat: Record<string, string> = {};
    try {
      const target = JSON.parse(await readFile(localePath, "utf8"));
      targetFlat = flattenMessages(target);
    } catch {
      targetFlat = {};
    }

    const sourceFlat = flattenMessages(source);
    const mergedTarget: Record<string, string> = {};
    for (const key of Object.keys(sourceFlat)) {
      mergedTarget[key] = targetFlat[key] ?? "";
    }

    return NextResponse.json({
      source: sourceFlat,
      target: mergedTarget,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  try {
    await requireSuperAdmin();
    const { locale } = await params;
    if (locale === "en") {
      return NextResponse.json({ error: "Cannot edit English source locale" }, { status: 400 });
    }

    const body = (await request.json()) as { flat: Record<string, string> };
    const nested = unflattenMessages(body.flat);
    const localePath = path.join(process.cwd(), "src/messages", `${locale}.json`);
    await writeFile(localePath, `${JSON.stringify(nested, null, 2)}\n`, "utf8");

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    const status = msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
