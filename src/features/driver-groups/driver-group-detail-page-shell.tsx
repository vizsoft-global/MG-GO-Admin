"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { deleteDriverGroup, updateDriverGroup } from "./driver-groups-actions";
import { DriverGroupFormDialog } from "./driver-group-form-dialog";
import { DriverGroupImportDialog } from "./driver-group-import-dialog";
import { DriverGroupIconBadge, DriverGroupMemberPicker } from "./driver-group-member-picker";
import { useDriverGroup } from "./use-driver-groups";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DriverGroupDetailPageShell({ groupId }: { groupId: string }) {
  const t = useTranslations("pages.driverGroups");
  const auth = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = auth.can("driver_groups.manage");
  const { data: group, isLoading, refetch } = useDriverGroup(groupId);
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!group) return;
    setMemberIds(group.member_ids);
  }, [group]);

  const handleMembersSave = () => {
    if (!group) return;
    startTransition(async () => {
      const result = await updateDriverGroup(group.id, {
        name: group.name,
        description: group.description,
        iconKey: group.icon_key,
        memberIds,
      });
      if ("error" in result) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("membersUpdated"));
      void refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.driverGroups.list() });
    });
  };

  const handleDelete = () => {
    if (!group || !confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      const result = await deleteDriverGroup(group.id);
      if ("error" in result) {
        toast.error(t("deleteFailed"));
        return;
      }
      toast.success(t("deleted"));
      router.push("/drivers/groups");
    });
  };

  if (isLoading || !group) {
    return (
      <AppPage>
        <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={group.name}
        description={t("detailSubtitle", { count: group.member_count })}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 cursor-pointer" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                {t("importMembers")}
              </Button>
              <Button variant="outline" className="h-9 cursor-pointer" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                {t("edit")}
              </Button>
              <Button
                variant="outline"
                className="h-9 cursor-pointer text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
                disabled={pending}
              >
                <Trash2 className="size-4" />
                {t("delete")}
              </Button>
            </div>
          ) : null
        }
      />
      <AppListCard title={t("membersTitle")}>
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <DriverGroupIconBadge iconKey={group.icon_key} />
            {group.description ? (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            ) : null}
          </div>
          {canManage ? (
            <>
              {memberIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("membersEmptyHint")}</p>
              ) : null}
              <DriverGroupMemberPicker
                selectedIds={memberIds}
                onChange={setMemberIds}
                initialOptions={group.members}
              />
              <Button className="h-9 cursor-pointer" disabled={pending} onClick={handleMembersSave}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("saveMembers")}
              </Button>
            </>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriverCode")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-sm text-muted-foreground">
                        {t("membersEmpty")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    group.members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.full_name}</TableCell>
                        <TableCell>{m.employee_id || "—"}</TableCell>
                        <TableCell>{m.driver_code}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          <Button render={<Link href="/drivers/groups" />} variant="outline" className="h-9 cursor-pointer">
            <ArrowLeft className="size-4" />
            {t("backToList")}
          </Button>
        </div>
      </AppListCard>
      <DriverGroupImportDialog
        groupId={group.id}
        open={importOpen}
        onOpenChange={setImportOpen}
        onApplied={() => {
          void refetch();
          void queryClient.invalidateQueries({ queryKey: queryKeys.driverGroups.list() });
        }}
      />
      <DriverGroupFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        group={group}
        onSaved={() => {
          void refetch();
          setEditOpen(false);
        }}
      />
    </AppPage>
  );
}
