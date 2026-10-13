"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, Loader2, Pencil, Plus, Send, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { SearchField } from "@/components/app/search-field";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { selectOptions } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import { fetchStaffAccessMatrix } from "./requests-settings-actions";
import {
  REQUEST_TYPE_SLUGS,
  type AccessLevel,
  type RequestTypeSlug,
  type StaffAccessRow,
  type StaffDepartmentMap,
  type StaffProfileOption,
} from "./settings-types";
import { StaffAccessDrawer } from "./staff-access-drawer";

/** Figma shows at most two type chips per cell, then a "+N" overflow chip. */
const MAX_VISIBLE_CHIPS = 2;

const ROLE_FILTERS = ["all", "sender", "view_only", "approver"] as const;

type RoleFilter = (typeof ROLE_FILTERS)[number];

type GrantRole = "sender" | "view_only" | "approver";

type ChipTone = "muted" | "decide";

type StaffRow = {
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  access: Partial<Record<RequestTypeSlug, AccessLevel>>;
};

const ROLE_CARDS: readonly {
  id: GrantRole;
  dotClass: string;
  titleKey: "senderTitle" | "receiverViewTitle" | "receiverDecideTitle";
  bodyKey: "senderBody" | "receiverViewBody" | "receiverDecideBody";
}[] = [
  {
    id: "sender",
    dotClass: "bg-zinc-400",
    titleKey: "senderTitle",
    bodyKey: "senderBody",
  },
  {
    id: "view_only",
    dotClass: "bg-blue-500",
    titleKey: "receiverViewTitle",
    bodyKey: "receiverViewBody",
  },
  {
    id: "approver",
    dotClass: "bg-orange-500",
    titleKey: "receiverDecideTitle",
    bodyKey: "receiverDecideBody",
  },
];

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

/**
 * Figma lists every staff member with "—" where they have no access, so an admin can grant
 * rights from the row itself. Seeding from the profile list keeps staff without any grant visible.
 */
function buildStaffRows(staff: StaffProfileOption[], rows: StaffAccessRow[]): StaffRow[] {
  const map = new Map<string, StaffRow>();
  for (const option of staff) {
    map.set(option.id, {
      profile_id: option.id,
      profile_name: option.full_name,
      profile_email: option.email,
      access: {},
    });
  }
  for (const row of rows) {
    const existing = map.get(row.profile_id) ?? {
      profile_id: row.profile_id,
      profile_name: row.profile_name,
      profile_email: row.profile_email,
      access: {} as Partial<Record<RequestTypeSlug, AccessLevel>>,
    };
    existing.access[row.request_type as RequestTypeSlug] = row.access_level;
    map.set(row.profile_id, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.profile_name.localeCompare(b.profile_name));
}

/**
 * Sender-for is a column on the Figma table. `request_staff_access` only stores
 * `view_only` and `approver`, so there is nothing to list until a sender grant exists.
 */
function senderTypesFor(): RequestTypeSlug[] {
  return [];
}

function typesFor(row: StaffRow, level: GrantRole): RequestTypeSlug[] {
  switch (level) {
    case "sender":
      return senderTypesFor();
    case "view_only":
    case "approver":
      return REQUEST_TYPE_SLUGS.filter((type) => row.access[type] === level);
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

function holdsRole(row: StaffRow, role: GrantRole): boolean {
  return typesFor(row, role).length > 0;
}

function filterIcon(filter: RoleFilter) {
  switch (filter) {
    case "all":
      return Users;
    case "sender":
      return Send;
    case "view_only":
      return Eye;
    case "approver":
      return ShieldCheck;
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
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
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
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
    let cancelled = false;
    void (async () => {
      const result = await fetchStaffAccessMatrix();
      if (cancelled) return;
      setLoading(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRawRows(result.rows);
      setStaffOptions(result.staffOptions);
      setDepartments(result.departments);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const staffRows = useMemo(
    () => buildStaffRows(staffOptions, rawRows),
    [staffOptions, rawRows],
  );

  const roleCounts = useMemo(() => {
    const counts: Record<GrantRole, number> = { sender: 0, view_only: 0, approver: 0 };
    for (const row of staffRows) {
      if (holdsRole(row, "sender")) counts.sender += 1;
      if (holdsRole(row, "view_only")) counts.view_only += 1;
      if (holdsRole(row, "approver")) counts.approver += 1;
    }
    return counts;
  }, [staffRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (roleFilter !== "all" && !holdsRole(row, roleFilter)) return false;
      if (
        typeFilter !== "all" &&
        !row.access[typeFilter] &&
        !senderTypesFor().includes(typeFilter)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        row.profile_name.toLowerCase().includes(q) ||
        (row.profile_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [staffRows, search, roleFilter, typeFilter]);

  function filterLabel(filter: RoleFilter): string {
    switch (filter) {
      case "all":
        return t("filter.all");
      case "sender":
        return t("filter.sender");
      case "view_only":
        return t("filter.receiverView");
      case "approver":
        return t("filter.receiverDecide");
      default: {
        const _exhaustive: never = filter;
        return _exhaustive;
      }
    }
  }

  function chipClass(tone: ChipTone): string {
    switch (tone) {
      case "muted":
        return "rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground";
      case "decide":
        return "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800";
      default: {
        const _exhaustive: never = tone;
        return _exhaustive;
      }
    }
  }

  function renderChips(types: RequestTypeSlug[], tone: ChipTone, allLabel: string) {
    if (types.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    if (types.length === REQUEST_TYPE_SLUGS.length) {
      return <span className={chipClass(tone)}>{allLabel}</span>;
    }
    const visible = types.slice(0, MAX_VISIBLE_CHIPS);
    const overflow = types.length - visible.length;
    return (
      <div className="flex flex-wrap items-center gap-1">
        {visible.map((type) => (
          <span key={type} className={chipClass(tone)}>
            {tTypes(type)}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            title={types.slice(MAX_VISIBLE_CHIPS).map((type) => tTypes(type)).join(", ")}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    );
  }

  const filtersActive =
    search.trim() !== "" || roleFilter !== "all" || typeFilter !== "all";

  return (
    <AppPage className="space-y-3">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tRoot("title"), href: "/employeedesk" },
          { label: t("hub"), href: "/employeedesk/settings" },
          { label: t("title") },
        ]}
        actions={
          <Button size="sm" className="h-9" onClick={() => setDrawerTarget("assign")}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t("assignStaff")}
          </Button>
        }
      />

      <div className="grid gap-2 lg:grid-cols-3">
        {ROLE_CARDS.map((card) => (
          <AppListCard key={card.id} className="space-y-1 p-4">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", card.dotClass)} aria-hidden />
              <h3 className="text-sm font-semibold">{t(card.titleKey)}</h3>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t(card.bodyKey)}</p>
            <button
              type="button"
              className="text-[12px] font-medium text-primary hover:underline"
              onClick={() =>
                setRoleFilter((current) => (current === card.id ? "all" : card.id))
              }
            >
              {t("staffCount", { count: roleCounts[card.id] })} · {t("viewList")}
            </button>
          </AppListCard>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{t("staffAccessTitle")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("staffAccessSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t("searchPlaceholder")}
            clearLabel={t("clearSearch")}
            className="w-56 flex-none"
          />
          <div className="flex flex-wrap items-center gap-1">
            {ROLE_FILTERS.map((filter) => (
              <ToggleChip
                key={filter}
                selected={roleFilter === filter}
                onClick={() => setRoleFilter(filter)}
                icon={filterIcon(filter)}
                className="h-9 px-2.5 text-xs"
              >
                {filterLabel(filter)}
              </ToggleChip>
            ))}
          </div>
          <Select
            value={typeFilter}
            onValueChange={(v) => v && setTypeFilter(v as "all" | RequestTypeSlug)}
            items={selectOptions([
              { value: "all", label: t("allRequestTypes") },
              ...REQUEST_TYPE_SLUGS.map((type) => ({ value: type, label: tTypes(type) })),
            ])}
          >
            <SelectTrigger className="h-9 w-[180px]">
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
          <span className="ms-auto text-xs text-muted-foreground">
            {loading ? "" : t("staffTotal", { count: filteredRows.length })}
          </span>
        </div>
      </div>

      <AppListCard className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filtersActive ? t("emptyFiltered") : t("empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDepartment")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colSenderFor")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colReceiverViewFor")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colReceiverDecideFor")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.profile_id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback
                          className={cn(
                            "text-[10px] font-semibold",
                            avatarTintFromName(row.profile_name),
                          )}
                        >
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
                    {renderChips(typesFor(row, "sender"), "muted", t("allTemplates"))}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    {renderChips(typesFor(row, "view_only"), "muted", t("allTypes"))}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    {renderChips(typesFor(row, "approver"), "decide", t("allTypes"))}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => setDrawerTarget(row)}
                    >
                      <Pencil className="me-1 h-3.5 w-3.5" />
                      {t("edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
