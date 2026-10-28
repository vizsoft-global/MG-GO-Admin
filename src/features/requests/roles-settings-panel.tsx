"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Eye, Loader2, Pencil, Plus, Send, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
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
import { OUTGOING_SENDER_KEYS } from "@/features/esign/outgoing-hub-categories";
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
  esignKeys: string[];
};

type EsignAccessRow = { profile_id: string; category_key: string };

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
function buildStaffRows(
  staff: StaffProfileOption[],
  rows: StaffAccessRow[],
  esignRows: EsignAccessRow[],
): StaffRow[] {
  const map = new Map<string, StaffRow>();
  for (const option of staff) {
    map.set(option.id, {
      profile_id: option.id,
      profile_name: option.full_name,
      profile_email: option.email,
      access: {},
      esignKeys: [],
    });
  }
  for (const row of rows) {
    const existing = map.get(row.profile_id) ?? {
      profile_id: row.profile_id,
      profile_name: row.profile_name,
      profile_email: row.profile_email,
      access: {} as Partial<Record<RequestTypeSlug, AccessLevel>>,
      esignKeys: [],
    };
    existing.access[row.request_type as RequestTypeSlug] = row.access_level;
    map.set(row.profile_id, existing);
  }
  for (const row of esignRows) {
    const existing = map.get(row.profile_id);
    if (!existing) continue;
    if (!existing.esignKeys.includes(row.category_key)) {
      existing.esignKeys.push(row.category_key);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.profile_name.localeCompare(b.profile_name));
}

function typesFor(row: StaffRow, level: GrantRole): string[] {
  switch (level) {
    case "sender":
      return row.esignKeys;
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
  const tAccess = useTranslations("pages.settings.accessControl");
  const tRoot = useTranslations("pages.requests");
  const [rawRows, setRawRows] = useState<StaffAccessRow[]>([]);
  const [esignRows, setEsignRows] = useState<EsignAccessRow[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffProfileOption[]>([]);
  const [departments, setDepartments] = useState<StaffDepartmentMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");
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
    setEsignRows(result.esignRows);
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
      setEsignRows(result.esignRows);
      setStaffOptions(result.staffOptions);
      setDepartments(result.departments);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const staffRows = useMemo(
    () => buildStaffRows(staffOptions, rawRows, esignRows),
    [staffOptions, rawRows, esignRows],
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

  const roleColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("colName"), locked: true },
      { id: "department", label: t("colDepartment"), categorical: true },
      { id: "sender", label: t("colSenderFor") },
      { id: "view", label: t("colReceiverViewFor") },
      { id: "decide", label: t("colReceiverDecideFor") },
      { id: "edit", label: t("assignStaff"), locked: true },
    ],
    [t],
  );
  const tablePrefs = useTablePrefs("requests.roles", roleColumns);
  useEffect(() => {
    setSearch(tablePrefs.appliedQuery);
  }, [tablePrefs.appliedQuery]);
  const shownColumns = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (roleFilter !== "all" && !holdsRole(row, roleFilter)) return false;
      if (
        typeFilter !== "all" &&
        !row.access[typeFilter as RequestTypeSlug] &&
        !row.esignKeys.includes(typeFilter)
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
        return "rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground";
      case "decide":
        return "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800";
      default: {
        const _exhaustive: never = tone;
        return _exhaustive;
      }
    }
  }

  function chipLabel(key: string): string {
    if ((REQUEST_TYPE_SLUGS as readonly string[]).includes(key)) {
      return tTypes(key as RequestTypeSlug);
    }
    return tAccess(`outgoingCategories.${key}`);
  }

  function renderChips(types: string[], tone: ChipTone, allLabel: string) {
    if (types.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    if (types.length === REQUEST_TYPE_SLUGS.length && types.every((key) => REQUEST_TYPE_SLUGS.includes(key as RequestTypeSlug))) {
      return <span className={chipClass(tone)}>{allLabel}</span>;
    }
    const visible = types.slice(0, MAX_VISIBLE_CHIPS);
    const overflow = types.length - visible.length;
    return (
      <div className="flex flex-wrap items-center gap-1">
        {visible.map((type) => (
          <span key={type} className={chipClass(tone)}>
            {chipLabel(type)}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground"
            title={types.slice(MAX_VISIBLE_CHIPS).map((type) => chipLabel(type)).join(", ")}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    );
  }

  const grouped = useMemo(
    () =>
      groupRows(
        filteredRows,
        tablePrefs.groupBy,
        { department: (row) => departments[row.profile_id] },
        {},
        "—",
      ),
    [departments, filteredRows, tablePrefs.groupBy],
  );
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
        actions={null}
      />

      <div className="grid gap-2 lg:grid-cols-3">
        {ROLE_CARDS.map((card) => (
          <AppListCard key={card.id} className="space-y-1 p-4">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", card.dotClass)} aria-hidden />
              <h3 className="text-sm font-semibold">{t(card.titleKey)}</h3>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t(card.bodyKey)}</p>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
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
          <p className="text-xs text-muted-foreground">{t("staffAccessSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            onValueChange={(v) => v && setTypeFilter(v)}
            items={selectOptions([
              { value: "all", label: t("allRequestTypes") },
              ...REQUEST_TYPE_SLUGS.map((type) => ({ value: type, label: tTypes(type) })),
              ...OUTGOING_SENDER_KEYS.map((key) => ({
                value: key,
                label: tAccess(`outgoingCategories.${key}`),
              })),
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
              {OUTGOING_SENDER_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {tAccess(`outgoingCategories.${key}`)}
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
        <TableToolbar
          prefs={tablePrefs}
          entity={t("staffAccessTitle")}
          columns={roleColumns}
          rowKind="dynamic"
          entityList
          filteredCount={filteredRows.length}
          totalCount={staffRows.length}
          onAdd={() => setDrawerTarget("assign")}
          addLabel={t("assignStaff")}
        />
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filtersActive ? t("emptyFiltered") : t("empty")}
          </p>
        ) : (
          tablePrefs.view === "grid" ? (
            <TableGridCards
              rows={filteredRows.map((row) => ({
                id: row.profile_id,
                name: row.profile_name,
                fields: [
                  { label: t("colDepartment"), value: departments[row.profile_id] ?? "—" },
                  { label: t("colSenderFor"), value: typesFor(row, "sender").length },
                ],
                onOpen: () => setDrawerTarget(row),
              }))}
            />
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {shownColumns.map((column) => (
                  <TableHead key={column.id} className={TABLE_HEAD_CLASS}>
                    {column.id === "edit" ? null : column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.flatMap((group) => [
                ...(tablePrefs.groupBy !== "none"
                  ? [
                      <TableRow key={`g-${group.key}`}>
                        <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                          {group.label} · {group.rows.length}
                        </TableCell>
                      </TableRow>,
                    ]
                  : []),
                ...group.rows.map((row) => {
                  const cells: Record<string, ReactNode> = {
                    name: (
                      <div className="min-w-0">
                        <TableNameCell name={row.profile_name} />
                        <p className="text-xs text-muted-foreground">
                          {row.profile_email ? row.profile_email : <EmptyCell />}
                        </p>
                      </div>
                    ),
                    department: departments[row.profile_id] ? departments[row.profile_id] : <EmptyCell />,
                    sender: renderChips(typesFor(row, "sender"), "muted", t("allTemplates")),
                    view: renderChips(typesFor(row, "view_only"), "muted", t("allTypes")),
                    decide: renderChips(typesFor(row, "approver"), "decide", t("allTypes")),
                    edit: (
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
                    ),
                  };
                  return (
                    <TableRow key={row.profile_id}>
                      {shownColumns.map((column) => (
                        <TableCell key={column.id}>{cells[column.id] ?? <EmptyCell />}</TableCell>
                      ))}
                    </TableRow>
                  );
                }),
              ])}
            </TableBody>
          </Table>
          )
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
        initialEsignKeys={drawerTarget && drawerTarget !== "assign" ? drawerTarget.esignKeys : undefined}
        onSaved={() => void load()}
      />
    </AppPage>
  );
}
