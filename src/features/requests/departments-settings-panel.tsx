"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { ToggleChip } from "@/components/app/toggle-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  addDepartmentMember,
  deleteDepartment,
  fetchDepartmentMembers,
  fetchDepartments,
  fetchStaffProfileOptions,
  removeDepartmentMember,
  updateDepartmentMemberRole,
  updateDepartmentMemberStatus,
  upsertDepartment,
} from "./requests-settings-actions";
import type { DepartmentMemberRow, DepartmentRoleTitle, DepartmentRow } from "./settings-types";

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function DepartmentsSettingsPanel() {
  const t = useTranslations("pages.requests.settings.departments");
  const tRoot = useTranslations("pages.requests");
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [members, setMembers] = useState<DepartmentMemberRow[]>([]);
  const [staffOptions, setStaffOptions] = useState<
    { id: string; full_name: string; email: string | null }[]
  >([]);
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [showAddDept, setShowAddDept] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [deptKey, setDeptKey] = useState("");
  const [deptLabelEn, setDeptLabelEn] = useState("");
  const [deleteDept, setDeleteDept] = useState<DepartmentRow | null>(null);

  const [memberProfileId, setMemberProfileId] = useState<string | null>(null);
  const [memberRole, setMemberRole] = useState<DepartmentRoleTitle>("agent");
  const [removeMember, setRemoveMember] = useState<DepartmentMemberRow | null>(null);

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    const [deptResult, staff] = await Promise.all([fetchDepartments(), fetchStaffProfileOptions()]);
    setLoading(false);
    if (deptResult.error) {
      toast.error(deptResult.error);
      return;
    }
    setDepartments(deptResult.rows);
    setStaffOptions(staff);
    setActiveDeptId((current) => current ?? deptResult.rows[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadDepartments();
  }, [loadDepartments]);

  const loadMembers = useCallback(async (departmentId: string) => {
    setMembersLoading(true);
    const result = await fetchDepartmentMembers(departmentId);
    setMembersLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setMembers(result.rows);
  }, []);

  useEffect(() => {
    if (activeDeptId) void loadMembers(activeDeptId);
    else setMembers([]);
  }, [activeDeptId, loadMembers]);

  const staffItems = useMemo(
    () =>
      staffOptions.map((s) => ({
        value: s.id,
        label: s.full_name,
        hint: s.email ?? undefined,
        keywords: [s.email ?? "", s.full_name],
      })),
    [staffOptions],
  );

  const activeDept = departments.find((d) => d.id === activeDeptId) ?? null;

  function handleAddDepartment() {
    startTransition(async () => {
      const result = await upsertDepartment({ key: deptKey, label_en: deptLabelEn });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("added"));
      setDeptKey("");
      setDeptLabelEn("");
      setShowAddDept(false);
      if (result.id) setActiveDeptId(result.id);
      await loadDepartments();
    });
  }

  function confirmDeleteDepartment() {
    if (!deleteDept) return;
    startTransition(async () => {
      const result = await deleteDepartment(deleteDept.id);
      setDeleteDept(null);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.deleteFailed"));
        return;
      }
      toast.success(t("deleted"));
      if (activeDeptId === deleteDept.id) setActiveDeptId(null);
      await loadDepartments();
    });
  }

  function handleAddMember() {
    if (!activeDeptId) {
      toast.error(t("errors.departmentRequired"));
      return;
    }
    if (!memberProfileId) {
      toast.error(t("errors.staffRequired"));
      return;
    }
    startTransition(async () => {
      const result = await addDepartmentMember({
        department_id: activeDeptId,
        profile_id: memberProfileId,
        role_title: memberRole,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.memberSaveFailed"));
        return;
      }
      toast.success(t("memberAdded"));
      setMemberProfileId(null);
      setShowAddMember(false);
      await Promise.all([loadMembers(activeDeptId), loadDepartments()]);
    });
  }

  function changeMemberRole(member: DepartmentMemberRow, role: DepartmentRoleTitle) {
    if (!activeDeptId || role === member.role_title) return;
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, role_title: role } : m)),
    );
    startTransition(async () => {
      const result = await updateDepartmentMemberRole(member.id, role);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.memberSaveFailed"));
        await loadMembers(activeDeptId);
      }
    });
  }

  function toggleMemberStatus(member: DepartmentMemberRow) {
    if (!activeDeptId) return;
    startTransition(async () => {
      const result = await updateDepartmentMemberStatus(member.id, !member.is_active);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.memberSaveFailed"));
        return;
      }
      await loadMembers(activeDeptId);
    });
  }

  function confirmRemoveMember() {
    if (!removeMember || !activeDeptId) return;
    startTransition(async () => {
      const result = await removeDepartmentMember(removeMember.id);
      setRemoveMember(null);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.memberDeleteFailed"));
        return;
      }
      toast.success(t("memberRemoved"));
      await Promise.all([loadMembers(activeDeptId), loadDepartments()]);
    });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/requests" },
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
        actions={
          activeDeptId ? (
            <Button
              type="button"
              className="h-9"
              disabled={isPending}
              onClick={() => setShowAddMember((v) => !v)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("addMember")}
            </Button>
          ) : undefined
        }
      />

      <AppListCard className="space-y-3 p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setActiveDeptId(dept.id)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                    dept.id === activeDeptId
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {dept.label_en}
                  <span className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px]">
                    {dept.member_count}
                  </span>
                </button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setShowAddDept((v) => !v)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("addDepartment")}
              </Button>
              {activeDept ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteDept(activeDept)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {t("remove")}
                </Button>
              ) : null}
            </div>

            {showAddDept ? (
              <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">{t("key")}</Label>
                  <Input className="h-9" value={deptKey} onChange={(e) => setDeptKey(e.target.value)} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">{t("labelEn")}</Label>
                  <Input
                    className="h-9"
                    value={deptLabelEn}
                    onChange={(e) => setDeptLabelEn(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    className="h-9 w-full"
                    disabled={isPending || !deptKey.trim() || !deptLabelEn.trim()}
                    onClick={handleAddDepartment}
                  >
                    {isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-1 h-3.5 w-3.5" />
                    )}
                    {t("addDepartment")}
                  </Button>
                </div>
              </div>
            ) : null}

            {departments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <Users className="h-8 w-8 opacity-40" />
                <p className="text-sm">{t("empty")}</p>
              </div>
            ) : activeDeptId ? (
              <>
                {showAddMember ? (
                <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 lg:grid-cols-4">
                  <div className="space-y-1 lg:col-span-2">
                    <Label className="text-xs">{t("staff")}</Label>
                    <SearchSelect
                      items={staffItems}
                      value={memberProfileId}
                      onChange={setMemberProfileId}
                      placeholder={t("staffPlaceholder")}
                      searchPlaceholder={t("staffSearch")}
                      recentsKey="rcm-department-members"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("role")}</Label>
                    <Select
                      value={memberRole}
                      onValueChange={(v) => setMemberRole(v as DepartmentRoleTitle)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agent">{t("roleAgent")}</SelectItem>
                        <SelectItem value="manager">{t("roleManager")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      className="h-9 w-full"
                      disabled={isPending || !memberProfileId}
                      onClick={handleAddMember}
                    >
                      {isPending ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-1 h-3.5 w-3.5" />
                      )}
                      {t("addMember")}
                    </Button>
                  </div>
                </div>
                ) : null}

                {membersLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  </div>
                ) : members.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("emptyMembers")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={TABLE_HEAD_CLASS}>{t("name")}</TableHead>
                        <TableHead className={TABLE_HEAD_CLASS}>{t("role")}</TableHead>
                        <TableHead className={TABLE_HEAD_CLASS}>{t("status")}</TableHead>
                        <TableHead className={TABLE_HEAD_CLASS} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-[10px]">
                                  {initialsOf(member.profile_name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{member.profile_name}</div>
                                {member.profile_email ? (
                                  <div className="text-[10px] text-muted-foreground">
                                    {member.profile_email}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={member.role_title}
                              onValueChange={(v) =>
                                v && changeMemberRole(member, v as DepartmentRoleTitle)
                              }
                            >
                              <SelectTrigger className="h-9 w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="agent">{t("roleAgent")}</SelectItem>
                                <SelectItem value="manager">{t("roleManager")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <ToggleChip
                              selected={member.is_active}
                              onClick={() => toggleMemberStatus(member)}
                            >
                              {member.is_active ? t("active") : t("inactive")}
                            </ToggleChip>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                              aria-label={t("remove")}
                              onClick={() => setRemoveMember(member)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            ) : null}
          </>
        )}
      </AppListCard>

      <SimpleConfirmDialog
        open={Boolean(deleteDept)}
        onOpenChange={(open) => !open && setDeleteDept(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("remove")}
        onConfirm={confirmDeleteDepartment}
      />

      <SimpleConfirmDialog
        open={Boolean(removeMember)}
        onOpenChange={(open) => !open && setRemoveMember(null)}
        title={t("removeMemberTitle")}
        description={t("removeMemberDescription")}
        confirmLabel={t("remove")}
        onConfirm={confirmRemoveMember}
      />
    </AppPage>
  );
}
