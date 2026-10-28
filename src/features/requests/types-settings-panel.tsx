"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchRequestTypeDefinitions,
  updateRequestType,
} from "./request-type-builder-actions";
import { RequestTypeFormDialog } from "./request-type-form-dialog";
import type { RequestTypeDefinitionRow } from "./settings-types";

export function TypesSettingsPanel() {
  const t = useTranslations("pages.requests.settings.types");
  const tRoot = useTranslations("pages.requests");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const addOpen = searchParams.get("add") === "1";

  const [rows, setRows] = useState<RequestTypeDefinitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchRequestTypeDefinitions();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setRows(result.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const typeColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "type", label: t("colType"), locked: true },
      { id: "fields", label: t("colFields") },
      { id: "chain", label: t("colChain") },
      { id: "requests", label: t("colRequests") },
      { id: "screenshots", label: t("colScreenshots"), categorical: true },
      { id: "status", label: t("colStatus"), categorical: true },
    ],
    [t],
  );
  const tablePrefs = useTablePrefs("requests.types", typeColumns);
  const filteredRows = useMemo(() => {
    const query = tablePrefs.appliedQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.label_en, row.label_ar, row.key].some((value) =>
        (value ?? "").toLowerCase().includes(query),
      ),
    );
  }, [rows, tablePrefs.appliedQuery]);
  const grouped = useMemo(
    () =>
      groupRows(
        filteredRows,
        tablePrefs.groupBy,
        {
          status: (row) => (row.is_active ? "active" : "inactive"),
          screenshots: (row) => (row.screenshot_restricted ? t("blocked") : t("allowed")),
        },
        {},
        "—",
      ),
    [filteredRows, t, tablePrefs.groupBy],
  );
  const shownColumns = tablePrefs.orderedColumns.filter((column) => tablePrefs.isVisible(column.id));

  const nextSortOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 1,
    [rows],
  );

  function setAddOpen(open: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set("add", "1");
    else params.delete("add");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  }

  function toggle(
    row: RequestTypeDefinitionRow,
    field: "screenshot_restricted" | "is_active",
  ) {
    const next = !row[field];
    setRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, [field]: next } : r)),
    );
    startTransition(async () => {
      const result = await updateRequestType(row.key, { [field]: next });
      if (!result.ok) {
        toast.error(result.error ?? t("errors.saveFailed"));
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, [field]: !next } : r)),
        );
      }
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
      />

      <AppListCard className="p-0">
        <TableToolbar
          prefs={tablePrefs}
          entity={t("title")}
          columns={typeColumns}
          rowKind="dynamic"
          entityList
          filteredCount={filteredRows.length}
          totalCount={rows.length}
          onAdd={() => setAddOpen(true)}
          addLabel={t("addRequestType")}
        />
        {tablePrefs.view === "grid" && !loading ? (
          <TableGridCards
            rows={filteredRows.map((row) => ({
              id: row.key,
              name: row.label_en,
              fields: [
                { label: t("colFields"), value: row.field_count },
                { label: t("colChain"), value: row.step_count },
                { label: t("colRequests"), value: row.request_count },
                { label: t("colStatus"), value: row.is_active ? "active" : "inactive" },
              ],
              onOpen: () => router.push(`/requests/settings/types/${row.key}`),
            }))}
          />
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {shownColumns.map((column) => (
                <TableHead key={column.id} className={TABLE_HEAD_CLASS}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={shownColumns.length} className="py-8 text-center text-xs text-muted-foreground">
                  {t("loading")}
                </TableCell>
              </TableRow>
            ) : (
              grouped.flatMap((group) => [
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
                    type: (
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <TableNameCell name={row.label_en} />
                          {row.is_system ? (
                            <span
                              title={t("systemLockHint")}
                              className="inline-flex items-center gap-0.5 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-px text-xs font-medium text-primary"
                            >
                              <Lock className="h-2.5 w-2.5" />
                              {t("systemBadge")}
                            </span>
                          ) : null}
                        </div>
                        <Link
                          href={`/requests/settings/types/${row.key}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("viewDetails")}
                        </Link>
                      </div>
                    ),
                    fields: row.field_count,
                    chain:
                      row.step_count > 0 ? (
                        t("stepsCount", { count: row.step_count })
                      ) : (
                        <span className="text-warning">{t("noChain")}</span>
                      ),
                    requests: row.request_count,
                    screenshots: (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={row.screenshot_restricted}
                          onCheckedChange={() => toggle(row, "screenshot_restricted")}
                          aria-label={t("colScreenshots")}
                        />
                        <span className="text-xs text-muted-foreground">
                          {row.screenshot_restricted ? t("blocked") : t("allowed")}
                        </span>
                      </div>
                    ),
                    status: (
                      <Switch
                        checked={row.is_active}
                        onCheckedChange={() => toggle(row, "is_active")}
                        aria-label={t("colStatus")}
                      />
                    ),
                  };
                  return (
                    <TableRow key={row.key}>
                      {shownColumns.map((column) => (
                        <TableCell key={column.id}>{cells[column.id] ?? <EmptyCell />}</TableCell>
                      ))}
                    </TableRow>
                  );
                }),
              ])
            )}
          </TableBody>
        </Table>
        )}
      </AppListCard>

      <p className="text-xs text-muted-foreground">{t("systemLockNote")}</p>

      <RequestTypeFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        nextSortOrder={nextSortOrder}
        onSaved={load}
      />
    </AppPage>
  );
}
