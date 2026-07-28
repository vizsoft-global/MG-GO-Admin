"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { approveUser, rejectUser } from "@/features/settings/access-requests-actions";
import type { AdminRoleRow } from "@/lib/auth/get-role-permissions";
import { Button } from "@/components/ui/button";
import { AppFormSection } from "@/components/app";
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

  if (pendingUsers.length === 0) {
    return (
      <AppFormSection title={t("title")} description={t("subtitle")}>
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </AppFormSection>
    );
  }

  return (
    <AppFormSection title={t("title")} description={t("subtitle")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("email")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead className="text-end">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.full_name ?? "—"}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    className="cursor-pointer rounded-lg"
                    disabled={isPending}
                    onClick={() => {
                      const roleId = selectedRoles[user.id] ?? assignableRoles[0]?.id;
                      if (!roleId) return;
                      startTransition(async () => {
                        const result = await approveUser(user.id, roleId);
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
    </AppFormSection>
  );
}
