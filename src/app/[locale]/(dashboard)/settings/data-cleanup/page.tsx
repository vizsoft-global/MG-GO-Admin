import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { DataCleanupPanel } from "@/features/settings/data-cleanup-panel";
import { purgeAllEntitiesForPermissions } from "@/features/settings/purge-entities";

export default async function DataCleanupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // `data.cleanup` rather than super admin only: a Manager, or a User holding a
  // `*.bulk_delete` tick, reaches the ordered Clear all list they can act on.
  // The row-by-row candidate tabs stay on super admin, because those actions
  // (and their storage sweeps) are super-admin gated on the server — a tab
  // whose every request would be refused is not a tab we draw.
  const session = await requirePermission(locale, "data.cleanup");

  const entities = purgeAllEntitiesForPermissions(
    session.permissions,
    session.isSuperAdmin,
  );

  return (
    <DataCleanupPanel
      purgeEntities={entities}
      canUseCandidateCleanup={session.isSuperAdmin}
      canUseFilteredPurge={session.isSuperAdmin}
    />
  );
}
