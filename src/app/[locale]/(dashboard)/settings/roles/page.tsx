import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { syncAdminPermissionsFromCatalog } from "@/lib/auth/sync-admin-permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getRoleUsageCounts } from "@/features/settings/roles-actions";
import {
  listRequestTypeOptions,
  listStaffAccess,
} from "@/features/settings/staff-access-actions";
import { RolesAccessPage } from "@/features/settings/access-control/roles-access-page";

type PermissionRow = { slug: string; label: string; category: string };

async function listPermissionRows(): Promise<PermissionRow[]> {
  const db = await staffDb();
  if (!db) return [];

  const snap = await db.collection(COLLECTIONS.adminPermissions).get();
  return snap.docs
    .map((doc) => {
      const data = doc.data();
      const slug = typeof data.slug === "string" ? data.slug : "";
      const label = typeof data.label === "string" ? data.label : "";
      const category = typeof data.category === "string" ? data.category : "";
      return { slug, label, category };
    })
    .filter((row) => row.slug.length > 0 && row.label.length > 0)
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label),
    );
}

export default async function RolesPermissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ user?: string; tab?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  void logAdminPageView("/settings/roles", "RolesPermissionsPage");

  await syncAdminPermissionsFromCatalog();

  const [allRoles, usageCounts, listed, requestTypes, permissions] = await Promise.all([
    getAllAdminRoles(),
    getRoleUsageCounts(),
    listStaffAccess(),
    listRequestTypeOptions(),
    listPermissionRows(),
  ]);

  return (
    <div className="w-full min-w-0 max-w-none">
      <RolesAccessPage
        tab={query.tab === "roles" ? "roles" : "staff"}
        userId={query.user ?? null}
        rows={listed.rows ?? []}
        loadError={listed.error}
        roles={allRoles}
        requestTypes={requestTypes.rows ?? []}
        permissions={permissions}
        usageCounts={usageCounts}
      />
    </div>
  );
}
