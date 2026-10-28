"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { approveUser, rejectUser } from "@/features/settings/access-requests-actions";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import { Button } from "@/components/ui/button";
import { AppFormSection } from "@/components/app";
import { EmptyCell, TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { groupBanner, groupRows, ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PendingUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
};

export function AccessRequestsPanel({
  pendingUsers,
  assignableRoles,
}: {
  pendingUsers: PendingUser[];
  assignableRoles: AdminRoleRow[];
}) {
  const t = useTranslations("pages.settings.accessRequests");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [selectedKinds, setSelectedKinds] = useState<Record<string, "manager" | "user">>({});
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("name"), locked: true },
      { id: "email", label: t("email") },
      { id: "kind", label: t("kind"), categorical: true },
      { id: "role", label: t("role"), categorical: true },
      { id: "actions", label: t("actions"), locked: true },
    ],
    [t],
  );
  const prefs = useTablePrefs("settings.accessRequests", columns);

  if (pendingUsers.length === 0) {
    return (
      <AppFormSection title={t("title")} description={t("subtitle")}>
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </AppFormSection>
    );
  }

  const matched = pendingUsers.filter((user) =>
    rowMatches(prefs.appliedQuery, [user.full_name, user.email]),
  );
  const groups = groupRows(matched, prefs.groupBy, (user) => {
    if (prefs.groupBy === "kind") return selectedKinds[user.id] ?? "user";
    if (prefs.groupBy === "role") {
      const roleId = selectedRoles[user.id] ?? assignableRoles[0]?.id ?? "";
      return assignableRoles.find((role) => role.id === roleId)?.name ?? roleId;
    }
    return "";
  });
  const ids = visibleColumnIds(prefs);

  return (
    <AppFormSection title={t("title")} description={t("subtitle")}>
        <ListToolbar
          prefs={prefs}
          entity={t("title")}
          columns={columns}
          rowKind="dynamic"
          filteredCount={matched.length}
          totalCount={pendingUsers.length}
        />
        <Table>
          <TableHeader>
            <TableRow>
              {ids.map((id) => (
                <TableHead key={id} className={id === "actions" ? "text-end" : undefined}>
                  {columns.find((column) => column.id === id)?.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {group.label ? (
                  <TableRow>
                    <TableCell colSpan={ids.length} className="bg-muted/40 text-xs font-semibold">
                      {groupBanner(group.label, group.rows.length)}
                    </TableCell>
                  </TableRow>
                ) : null}
                {group.rows.map((user) => (
              <TableRow key={user.id}>
                {ids.map((id) => (
                  <TableCell key={id} className={id === "actions" ? "flex justify-end gap-2" : undefined}>
                    {id === "name" ? <TableNameCell name={user.full_name} /> : null}
                    {id === "email" ? (user.email ? user.email : <EmptyCell />) : null}
                    {id === "kind" ? (
                  <select
                    className="h-9 w-full max-w-[140px] rounded-lg border border-input bg-background px-2 text-sm"
                    value={selectedKinds[user.id] ?? "user"}
                    onChange={(e) =>
                      setSelectedKinds((prev) => ({
                        ...prev,
                        [user.id]: e.target.value === "manager" ? "manager" : "user",
                      }))
                    }
                    disabled={isPending}
                  >
                    <option value="user">{t("kindUser")}</option>
                    <option value="manager">{t("kindManager")}</option>
                  </select>
                    ) : null}
                    {id === "role" ? (
                  <select
                    className="h-9 w-full max-w-[200px] rounded-lg border border-input bg-background px-2 text-sm"
                    value={selectedRoles[user.id] ?? assignableRoles[0]?.id ?? ""}
                    onChange={(e) =>
                      setSelectedRoles((prev) => ({ ...prev, [user.id]: e.target.value }))
                    }
                    disabled={isPending}
                  >
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                    ) : null}
                    {id === "actions" ? (
                  <>
                  <Button
                    size="sm"
                    className="cursor-pointer rounded-lg"
                    disabled={isPending}
                    onClick={() => {
                      const roleId = selectedRoles[user.id] ?? assignableRoles[0]?.id;
                      if (!roleId) return;
                      const accessKind = selectedKinds[user.id] ?? "user";
                      startTransition(async () => {
                        const result = await approveUser(user.id, roleId, accessKind);
                        if (result.error) {
                          toast.error(t("errors.saveFailed"));
                          return;
                        }
                        toast.success(t("approved"));
                        router.refresh();
                      });
                    }}
                  >
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="cursor-pointer rounded-lg"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        const result = await rejectUser(user.id);
                        if (result.error) {
                          toast.error(t("errors.saveFailed"));
                          return;
                        }
                        toast.success(t("rejected"));
                        router.refresh();
                      });
                    }}
                  >
                    {t("reject")}
                  </Button>
                  </>
                    ) : null}
                  </TableCell>
                ))}
              </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
    </AppFormSection>
  );
}
