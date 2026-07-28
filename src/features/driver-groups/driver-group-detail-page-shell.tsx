"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import { deleteDriverGroup, updateDriverGroup } from "./driver-groups-actions";
import { DriverGroupFormDialog } from "./driver-group-form-dialog";
import { DriverGroupIconBadge, DriverGroupMemberPicker } from "./driver-group-member-picker";
import { useDriverGroup } from "./use-driver-groups";
import type { DriverGroupMemberOption } from "./types";

async function loadMemberOptions(
  memberIds: string[],
): Promise<DriverGroupMemberOption[]> {
  if (memberIds.length === 0) return [];
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient() as any;
  const { data } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles(full_name)")
    .in("id", memberIds);
  return (data ?? []).map((d: any) => {
    const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      id: d.id,
      driver_code: d.driver_code,
      employee_id: d.employee_id ?? "",
      full_name: profile?.full_name?.trim() || "Driver",
    };
  });
}

export function DriverGroupDetailPageShell({ groupId }: { groupId: string }) {
  const t = useTranslations("pages.driverGroups");
  const auth = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = auth.can("driver_groups.manage");
  const { data: group, isLoading, refetch } = useDriverGroup(groupId);
  const [editOpen, setEditOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberOptions, setMemberOptions] = useState<DriverGroupMemberOption[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!group) return;
    setMemberIds(group.member_ids);
    void loadMemberOptions(group.member_ids).then(setMemberOptions);
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
              <DriverGroupMemberPicker
                selectedIds={memberIds}
                onChange={setMemberIds}
                initialOptions={memberOptions}
              />
              <Button className="h-9 cursor-pointer" disabled={pending} onClick={handleMembersSave}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("saveMembers")}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("memberCount", { count: group.member_count })}</p>
          )}
          <Button render={<Link href="/drivers/groups" />} variant="outline" className="h-9 cursor-pointer">
            <ArrowLeft className="size-4" />
            {t("backToList")}
          </Button>
        </div>
      </AppListCard>
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
