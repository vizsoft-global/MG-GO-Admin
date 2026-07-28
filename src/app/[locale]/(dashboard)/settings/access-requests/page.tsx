import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { createClient } from "@/lib/supabase/server";
import { AccessRequestsPanel } from "@/features/settings/access-requests-panel";

export default async function AccessRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  const supabase = await createClient();
  const allRoles = await getAllAdminRoles();

  const { data: pendingUsers } = await supabase
    .from("profiles")
    .select("id, email, full_name, created_at")
    .eq("role", "staff")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: false });

  const assignableRoles = allRoles.filter((r) => !r.isSuperAdmin);

  return (
    <AccessRequestsPanel
      pendingUsers={pendingUsers ?? []}
      assignableRoles={assignableRoles}
    />
  );
}
