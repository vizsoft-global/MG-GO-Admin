import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAdminProfile } from "@/lib/auth/sync-profile";
import { getAppOpsSettings } from "@/lib/auth/app-settings";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const locale = searchParams.get("locale") ?? "en";
  const errorParam = searchParams.get("error");

  if (errorParam || !code) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=oauth`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=oauth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=oauth`);
  }

  const next = searchParams.get("next");
  if (next?.includes("reset-password")) {
    return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : `/${locale}/reset-password`}`);
  }

  const sync = await syncAdminProfile(supabase, user, locale);

  if (!sync.ok) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/${locale}/login?error=${sync.reason === "not_authorized" ? "not_authorized" : "oauth"}`,
    );
  }

  const ops = await getAppOpsSettings();

  if (!ops.superAdminClaimed) {
    return NextResponse.redirect(`${origin}/${locale}/setup/claim-super-admin`);
  }

  if (sync.approvalStatus === "pending") {
    return NextResponse.redirect(`${origin}/${locale}/pending-approval`);
  }

  return NextResponse.redirect(`${origin}/${locale}/dashboard`);
}
