"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, Loader2, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { fetchStaffAccessMatrix } from "./requests-settings-actions";
import { REQUEST_TYPE_SLUGS, type AccessLevel, type RequestTypeSlug, type StaffAccessRow, type StaffDepartmentMap, type StaffProfileOption } from "./settings-types";
import { StaffAccessDrawer } from "./staff-access-drawer";

/** Figma shows at most two type chips per cell, then a "+N" overflow chip. */
const MAX_VISIBLE_CHIPS = 2;

type StaffRow = {
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  access: Partial<Record<RequestTypeSlug, AccessLevel>>;
};

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

function groupByStaff(rows: StaffAccessRow[]): StaffRow[] {
  const map = new Map<string, StaffRow>();
  for (const row of rows) {
    const existing = map.get(row.profile_id);
    const access: Partial<Record<RequestTypeSlug, AccessLevel>> = existing?.access ?? {};
    access[row.request_type as RequestTypeSlug] = row.access_level;
    map.set(row.profile_id, {
      profile_id: row.profile_id,
      profile_name: row.profile_name,
      profile_email: row.profile_email,
      access,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.profile_name.localeCompare(b.profile_name));
}

export function RolesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.roles");
  const tTypes = useTranslations("pages.requests.types");
  const tRoot = useTranslations("pages.requests");
  const [rawRows, setRawRows] = useState<StaffAccessRow[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffProfileOption[]>([]);
  const [departments, setDepartments] = useState<StaffDepartmentMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "view_only" | "approver">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | RequestTypeSlug>("all");
  const [drawerTarget, setDrawerTarget] = useState<StaffRow | null | "assign">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchStaffAccessMatrix();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setRawRows(result.rows);
    setStaffOptions(result.staffOptions);
    setDepartments(result.departments);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const staffRows = useMemo(() => groupByStaff(rawRows), [rawRows]);

  const viewOnlyCount = useMemo(
    () => staffRows.filter((r) => Object.values(r.access).includes("view_only")).length,
    [staffRows],
  );
  const approverCount = useMemo(
    () => staffRows.filter((r) => Object.values(r.access).includes("approver")).length,
    [staffRows],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (roleFilter !== "all" && !Object.values(row.access).includes(roleFilter)) return false;
      if (typeFilter !== "all" && !row.access[typeFilter]) return false;
      if (!q) return true;
      return (
        row.profile_name.toLowerCase().includes(q) ||
        (row.profile_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [staffRows, search, roleFilter, typeFilter]);

  function typesFor(row: StaffRow, level: AccessLevel): RequestTypeSlug[] {
    return REQUEST_TYPE_SLUGS.filter((type) => row.access[type] === level);
  }

  function renderChips(types: RequestTypeSlug[], tone: "view" | "approve") {
    if (types.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    const visible = types.slice(0, MAX_VISIBLE_CHIPS);
    const overflow = types.length - visible.length;
    const chipClass =
      tone === "approve"
        ? "rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"
        : "rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium";
    return (
      <div className="flex flex-wrap items-center gap-1">
        {visible.map((type) => (
          <span key={type} className={chipClass}>
            {tTypes(type)}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className="text-[10px] font-medium text-muted-foreground"
            title={types.slice(MAX_VISIBLE_CHIPS).map((type) => tTypes(type)).join(", ")}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    );
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
          <Button size="sm" className="h-9" onClick={() => setDrawerTarget("assign")}>
            <UserPlus className="me-1.5 h-3.5 w-3.5" />
            {t("assignStaff")}
          </Button>
        }
      />

      <div className="grid gap-2 lg:grid-cols-2">
        <AppListCard className="space-y-1 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/40">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <h3 className="text-sm font-semibold">{t("viewOnlyTitle")}</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("viewOnlyBody")}</p>
          <button
            type="button"
            className="text-[11px] font-medium text-primary hover:underline"
            onClick={() => setRoleFilter("view_only")}
          >
            {t("staffCount", { count: viewOnlyCount })} · {t("viewList")}
          </button>
        </AppListCard>

        <AppListCard className="space-y-1 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
            </span>
            <h3 className="text-sm font-semibold">{t("approverTitle")}</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("approverBody")}</p>
          <button
            type="button"
            className="text-[11px] font-medium text-primary hover:underline"
            onClick={() => setRoleFilter("approver")}
          >
            {t("staffCount", { count: approverCount })} · {t("viewList")}
          </button>
        </AppListCard>
      </div>

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="me-auto">
            <h3 className="text-sm font-semibold">{t("staffAccessTitle")}</h3>
            <p className="text-[11px] text-muted-foreground">{t("staffAccessSubtitle")}</p>
          </div>
          <Input
            className="h-9 w-56"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-1">
            {(["all", "view_only", "approver"] as const).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={roleFilter === f ? "default" : "outline"}
                className="h-8"
                onClick={() => setRoleFilter(f)}
              >
                {t(`filter.${f}`)}
              </Button>
            ))}
          </div>
          <Select
            value={typeFilter}
            onValueChange={(v) => v && setTypeFilter(v as "all" | RequestTypeSlug)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allRequestTypes")}</SelectItem>
              {REQUEST_TYPE_SLUGS.map((type) => (
                <SelectItem key={type} value={type}>
                  {tTypes(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">
            {loading ? "" : t("staffTotal", { count: filteredRows.length })}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDepartment")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colViewOnlyFor")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colApproverFor")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => {
                const viewTypes = typesFor(row, "view_only");
                const approveTypes = typesFor(row, "approver");
                return (
                  <TableRow key={row.profile_id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-[10px]">
                            {initialsOf(row.profile_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{row.profile_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {row.profile_email ?? "—"}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {departments[row.profile_id] ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {renderChips(viewTypes, "view")}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {renderChips(approveTypes, "approve")}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-primary hover:bg-primary/10"
                        onClick={() => setDrawerTarget(row)}
                      >
                        <Pencil className="me-1 h-3.5 w-3.5" />
                        {t("edit")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </AppListCard>

      <StaffAccessDrawer
        open={drawerTarget !== null}
        onOpenChange={(open) => !open && setDrawerTarget(null)}
        staff={
          drawerTarget && drawerTarget !== "assign"
            ? {
                id: drawerTarget.profile_id,
                full_name: drawerTarget.profile_name,
                email: drawerTarget.profile_email,
                department: departments[drawerTarget.profile_id] ?? null,
              }
            : null
        }
        staffOptions={staffOptions}
        initialAccess={drawerTarget && drawerTarget !== "assign" ? drawerTarget.access : undefined}
        onSaved={() => void load()}
      />
    </AppPage>
  );
}
