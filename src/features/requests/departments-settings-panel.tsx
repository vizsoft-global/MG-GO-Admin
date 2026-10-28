"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableToolbar,
  useTablePrefs,
  TableNameCell,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
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
import { selectOptions } from "@/lib/select-items";
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

function memberRoleLabel(
  role: DepartmentRoleTitle,
  labels: { agent: string; manager: string },
): string {
  switch (role) {
    case "agent":
      return labels.agent;
    case "manager":
      return labels.manager;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
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
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("name"), locked: true },
      { id: "role", label: t("role"), categorical: true },
      { id: "status", label: t("status"), categorical: true },
      { id: "remove", label: t("remove"), locked: true },
    ],
    [t],
  );
  const prefs = useTablePrefs("request-departments", columns);
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const filteredMembers = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => {
      const role = memberRoleLabel(member.role_title, {
        agent: t("roleAgent"),
        manager: t("roleManager"),
      });
      const status = member.is_active ? t("active") : t("inactive");
      return [member.profile_name, member.profile_email ?? "", role, status]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [members, prefs.appliedQuery, t]);
  const groupedMembers = useMemo(
    () =>
      groupRows(
        filteredMembers,
        prefs.groupBy,
        {
          role: (member) =>
            memberRoleLabel(member.role_title, {
              agent: t("roleAgent"),
              manager: t("roleManager"),
            }),
          status: (member) => (member.is_active ? t("active") : t("inactive")),
        },
        {},
        "—",
      ),
    [filteredMembers, prefs.groupBy, t],
  );

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

  const roleOptions = useMemo(
    () =>
      selectOptions([
        { value: "agent", label: t("roleAgent") },
        { value: "manager", label: t("roleManager") },
      ]),
    [t],
  );

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
            <div className="flex flex-wrap items-center gap-2 border-b border-border">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setActiveDeptId(dept.id)}
                  className={cn(
                    "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
                    dept.id === activeDeptId
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {dept.label_en}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs",
                      dept.id === activeDeptId
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
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
                      items={roleOptions}
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

                <TableToolbar
                  prefs={prefs}
                  entity={t("title")}
                  columns={columns}
                  rowKind="dynamic"
                  filteredCount={filteredMembers.length}
                  totalCount={members.length}
                />
                {membersLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {shownColumns.map((column) => (
                          <TableHead key={column.id} className={TABLE_HEAD_CLASS}>
                            {column.id === "remove" ? null : column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMembers.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={shownColumns.length}
                            className="py-6 text-center text-sm text-muted-foreground"
                          >
                            {t("emptyMembers")}
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {groupedMembers.flatMap((group) => [
                        ...(prefs.groupBy !== "none"
                          ? [
                              <TableRow key={`g-${group.key}`}>
                                <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                                  {group.label} · {group.rows.length}
                                </TableCell>
                              </TableRow>,
                            ]
                          : []),
                        ...group.rows.map((member) => {
                          const cells: Record<string, ReactNode> = {
                            name: (
                              <div className="min-w-0">
                                <TableNameCell name={member.profile_name} />
                                {member.profile_email ? (
                                  <div className="text-xs text-muted-foreground">{member.profile_email}</div>
                                ) : null}
                              </div>
                            ),
                            role: (
                            <Select
                              value={member.role_title}
                              onValueChange={(v) =>
                                v && changeMemberRole(member, v as DepartmentRoleTitle)
                              }
                              items={roleOptions}
                            >
                              <SelectTrigger className="h-9 w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="agent">{t("roleAgent")}</SelectItem>
                                <SelectItem value="manager">{t("roleManager")}</SelectItem>
                              </SelectContent>
                            </Select>
                            ),
                            status: (
                            <ToggleChip
                              selected={member.is_active}
                              onClick={() => toggleMemberStatus(member)}
                            >
                              {member.is_active ? t("active") : t("inactive")}
                            </ToggleChip>
                            ),
                            remove: (
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
                            ),
                          };
                          return (
                        <TableRow key={member.id}>
                          {shownColumns.map((column) => (
                            <TableCell key={column.id}>{cells[column.id] ?? <EmptyCell />}</TableCell>
                          ))}
                        </TableRow>
                          );
                        }),
                      ])}
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
