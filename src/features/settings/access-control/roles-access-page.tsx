"use client";

import { useTranslations } from "next-intl";
import { LAYOUT } from "@/components/app/layout-spacing";
import { SegmentOption } from "@/components/app/toggle-chip";
import { RolesPermissionsPanel } from "@/features/settings/roles-permissions-panel";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import type {
  RequestTypeOption,
  StaffAccessListRow,
} from "@/features/settings/staff-access-actions";
import { useRouter } from "@/i18n/navigation";
import { AccessControlShell } from "./access-control-shell";

type PermissionRow = { slug: string; label: string; category: string };

export function RolesAccessPage({
  tab,
  userId,
  rows,
  loadError,
  roles,
  requestTypes,
  permissions,
  usageCounts,
}: {
  tab: "staff" | "roles";
  userId?: string | null;
  rows: StaffAccessListRow[];
  loadError?: string;
  roles: AdminRoleRow[];
  requestTypes: RequestTypeOption[];
  permissions: PermissionRow[];
  usageCounts: { roleId: string; userCount: number }[];
}) {
  const t = useTranslations("pages.settings.accessControl");
  const router = useRouter();

  return (
    <div className={`flex min-h-0 flex-col ${LAYOUT.commandViewportHeight}`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
        <SegmentOption
          selected={tab === "staff"}
          onClick={() =>
            router.replace(userId ? `/settings/roles?user=${userId}` : "/settings/roles")
          }
          variant="success"
        >
          {t("tabStaff")}
        </SegmentOption>
        <SegmentOption
          selected={tab === "roles"}
          onClick={() =>
            router.replace(
              userId ? `/settings/roles?tab=roles&user=${userId}` : "/settings/roles?tab=roles",
            )
          }
        >
          {t("tabRoles")}
        </SegmentOption>
      </div>
      <div className={tab === "staff" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <AccessControlShell
          rows={rows}
          loadError={loadError}
          roles={roles}
          requestTypes={requestTypes}
          initialUserId={userId}
        />
      </div>
      <div className={tab === "roles" ? "min-h-0 flex-1 overflow-auto" : "hidden"}>
        <RolesPermissionsPanel
          roles={roles}
          permissions={permissions}
          usageCounts={usageCounts}
        />
      </div>
    </div>
  );
}
