"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
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
import {
  deleteStaffAccess,
  fetchStaffAccess,
  fetchStaffProfileOptions,
  upsertStaffAccess,
} from "./requests-settings-actions";
import { REQUEST_TYPE_SLUGS, type RequestTypeSlug, type StaffAccessRow } from "./settings-types";

export function DepartmentsSettingsPanel() {
  const t = useTranslations("pages.requests.settings.departments");
  const tTypes = useTranslations("pages.requests.types");
  const [rows, setRows] = useState<StaffAccessRow[]>([]);
  const [staffOptions, setStaffOptions] = useState<
    { id: string; full_name: string; email: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<StaffAccessRow | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<RequestTypeSlug>("leave");
  const [accessLevel, setAccessLevel] = useState<"view_only" | "approver">("view_only");

  const load = useCallback(async () => {
    setLoading(true);
    const [accessResult, staff] = await Promise.all([
      fetchStaffAccess(),
      fetchStaffProfileOptions(),
    ]);
    setLoading(false);
    if (accessResult.error) {
      toast.error(accessResult.error);
      return;
    }
    setRows(accessResult.rows);
    setStaffOptions(staff);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const typeOptions = useMemo(
    () => REQUEST_TYPE_SLUGS.map((slug) => ({ value: slug, label: tTypes(slug) })),
    [tTypes],
  );

  function handleAdd() {
    if (!profileId) {
      toast.error(t("errors.staffRequired"));
      return;
    }
    startTransition(async () => {
      const result = await upsertStaffAccess({
        profile_id: profileId,
        request_type: requestType,
        access_level: accessLevel,
      });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("added"));
      setProfileId(null);
      await load();
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteStaffAccess(deleteTarget.id);
      setDeleteTarget(null);
      if (!result.ok) {
        toast.error(result.error ?? t("errors.deleteFailed"));
        return;
      }
      toast.success(t("deleted"));
      await load();
    });
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("hub"), href: "/requests/settings" },
          { label: t("title") },
        ]}
      />

      <AppListCard className="space-y-3 p-4">
        <div className="grid gap-2 lg:grid-cols-4">
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">{t("staff")}</Label>
            <SearchSelect
              items={staffItems}
              value={profileId}
              onChange={setProfileId}
              placeholder={t("staffPlaceholder")}
              searchPlaceholder={t("staffSearch")}
              recentsKey="rcm-staff-access"
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("requestType")}</Label>
            <Select value={requestType} onValueChange={(v) => v && setRequestType(v as RequestTypeSlug)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("accessLevel")}</Label>
            <Select
              value={accessLevel}
              onValueChange={(v) => setAccessLevel(v as "view_only" | "approver")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view_only">{t("viewOnly")}</SelectItem>
                <SelectItem value="approver">{t("approver")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          type="button"
          className="h-9"
          disabled={isPending || !profileId}
          onClick={handleAdd}
        >
          {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
          {t("addGrant")}
        </Button>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("staff")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("requestType")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("accessLevel")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{row.profile_name}</div>
                    {row.profile_email ? (
                      <div className="text-[10px] text-muted-foreground">{row.profile_email}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{tTypes(row.request_type as RequestTypeSlug)}</TableCell>
                  <TableCell>
                    {row.access_level === "approver" ? t("approver") : t("viewOnly")}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t("remove")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AppListCard>

      <SimpleConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("remove")}
        onConfirm={confirmDelete}
      />
    </AppPage>
  );
}
