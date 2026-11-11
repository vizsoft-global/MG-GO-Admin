"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Info, Redo2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { PayrollListToolbar, usePayrollListPrefs } from "./payroll-list-toolbar";
import { cn } from "@/lib/utils";
import {
  isoDayLabel,
  payrollRiderMatchesSearch,
  type PayrollPeriod,
} from "./payroll-formulas";
import { exportPayrollAttendanceOrdersProjectCsv } from "./payroll-csv";
import {
  activeFilterChips,
  columnFilterActive,
  PayrollColumnHeader,
  PayrollFilterChips,
  rowMatchesColumnFilters,
  sortByColumn,
  type ColumnFilters,
  type ColumnSort,
} from "./payroll-column-filter";
import {
  AO_LEAD_COLUMNS,
  dayAdjustmentInput,
  dayClipboardToken,
  dayColumnId,
  dayOrdersColumnId,
  PAYROLL_SERIAL_COLUMN,
  riderColumnValue,
  workingHoursColumnId,
} from "./payroll-rider-columns";
import {
  DEFAULT_PROJECT_CLIENTS,
  dayColumnLabelKey,
  projectConfigOf,
  projectCounts,
  projectExportName,
  projectKpis,
  projectRowTotals,
  ridersForProject,
  unassignedProjectCount,
  type PayrollProjectClient,
  type PayrollProjectView,
} from "./payroll-projects";
import { PayrollProjectCards, PayrollProjectKpis } from "./payroll-project-cards";
import { PayrollRiderCards } from "./payroll-rider-cards";
import { PayrollDailyUploadDialog } from "./payroll-daily-upload-dialog";
import {
  PayrollHoursCell,
  PayrollHoursDialog,
  type HoursEditTarget,
} from "./payroll-hours-cell";
import { PayrollManualChangesPanel } from "./payroll-manual-changes";
import { usePayrollAdjustmentAudit } from "./use-payroll";
import { dayClass, PayrollFillHandle, ZoneCategoryPill } from "./payroll-grid";
import { payrollAssignField } from "./payroll-assign";
import {
  PayrollAssignCell,
  PayrollIdentityCell,
  PayrollOrderCell,
  payrollIdentityField,
  payrollIdentityValue,
} from "./payroll-identity-cell";
import { PayrollStatusCell } from "./payroll-status-cell";
import { usePayrollStatusFilterList } from "./payroll-status-context";
import { usePayrollAdjust } from "./payroll-adjust-context";
import { aoShownOrders } from "./payroll-orders-display";
import { PayrollCellMenu, type PayrollCellMenuState } from "./payroll-cell-menu";
import {
  columnHiddenIn,
  configByKey,
  exportLabelsFromConfig,
  hiddenSetFor,
  resolveColumnLabel,
} from "./payroll-column-config";
import { PayrollHeadingLabel, stickyIdentityStyle } from "./payroll-heading";
import { ColumnOrderMenu } from "@/components/app/column-order-menu";
import { useListColumns } from "@/hooks/use-list-columns";
import { PAYROLL_AO_COLUMNS_PREF_KEY } from "@/lib/ui-preferences/types";
import { identityOffsets, withSerialColumn } from "./payroll-table-identity";
import { PayrollRowLink } from "./payroll-row-link";
import { payrollColumnLabel } from "./payroll-column-labels";
import { cellParticular } from "./payroll-particulars";
import { fillTargetCells, tilePasteOntoSelection, visibleFillTargets } from "./payroll-snapshot";
import {
  layoutFromSampleCell,
  startGridEdgeScroll,
  type GridEdgeScrollLayout,
} from "./grid-edge-scroll";
import type { PayrollRiderRow } from "./payroll-types";
import { usePayrollColumnConfig } from "./use-payroll";

type CellRect = { r0: number; c0: number; r1: number; c1: number };

function normalizeRect(rect: CellRect) {
  return {
    top: Math.min(rect.r0, rect.r1),
    bottom: Math.max(rect.r0, rect.r1),
    left: Math.min(rect.c0, rect.c1),
    right: Math.max(rect.c0, rect.c1),
  };
}

export function PayrollAttendanceOrdersTab({
  month,
  riders,
  canExport,
  canManage = false,
  today,
  view = "americana",
  views,
  onViewChange,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage?: boolean;
  /** Kuwait date the page calls today; drives the Rider Status column. */
  today: string;
  /**
   * The selected client card. Owned by the shell so it can hide the status chips
   * for a client with no day status — Five Guys — while every other tab stays
   * exactly as it was.
   */
  view?: PayrollProjectView;
  /** The active client catalog, in card order. */
  views?: readonly PayrollProjectClient[];
  onViewChange?: (next: PayrollProjectView) => void;
}) {
  const t = useTranslations("pages.payroll");
  const statusList = usePayrollStatusFilterList();
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [hoursTarget, setHoursTarget] = useState<HoursEditTarget | null>(null);
  const projectViews = views ?? DEFAULT_PROJECT_CLIENTS;
  const config = projectConfigOf(view, projectViews);
  const audit = usePayrollAdjustmentAudit({ from: month.from, to: month.to });
  const { prefs: listPrefs, update: updateListPrefs } = usePayrollListPrefs("payroll-ao");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const [rect, setRect] = useState<CellRect | null>(null);
  const [fillPreview, setFillPreview] = useState<CellRect | null>(null);
  const [menu, setMenu] = useState<PayrollCellMenuState | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "select" | "fill";
    r0: number;
    c0: number;
    r1: number;
    c1: number;
    rowIds: readonly string[];
  } | null>(null);
  const rectRef = useRef<CellRect | null>(null);
  const layoutRef = useRef<GridEdgeScrollLayout | null>(null);
  const dragStopRef = useRef<(() => void) | null>(null);
  const endDragRef = useRef<() => void>(() => undefined);
  const gridMetricsRef = useRef({ rowCount: 0, colCount: 0 });
  const session = usePayrollAdjust();
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);
  /** Columns the operator may show, hide and reorder on this sheet. */
  const leadColumnIds = useMemo(
    () =>
      AO_LEAD_COLUMNS.filter(
        // Keeta riders work from the pool: the SOP removes the Restaurant column
        // rather than printing "(Pool)" on every row.
        (column) => config.showRestaurant || column.id !== "restaurant",
      ).map((column) => column.id),
    [config.showRestaurant],
  );
  /** The heading config still decides what starts hidden; the operator can change it after. */
  const defaultLeadVisible = useMemo(
    () => leadColumnIds.filter((id) => !columnHiddenIn(id, "ao", headingConfig)),
    [leadColumnIds, headingConfig],
  );
  const leadColumns = useListColumns(PAYROLL_AO_COLUMNS_PREF_KEY, leadColumnIds, {
    defaultVisible: defaultLeadVisible,
  });
  const columns = useMemo(() => {
    const byId = new Map(AO_LEAD_COLUMNS.map((column) => [column.id, column]));
    const ordered = leadColumns.visibleIds
      .map((id) => byId.get(id))
      .filter((column): column is NonNullable<typeof column> => Boolean(column));
    return withSerialColumn(ordered, PAYROLL_SERIAL_COLUMN);
  }, [leadColumns.visibleIds]);
  const columnOffsets = useMemo(() => identityOffsets(columns), [columns]);
  const frozenCount = columnOffsets.filter((offset) => offset >= 0).length;
  const dates = month.dates;
  const editable = canManage;

  /** The riders on the selected card, before search and the column funnels. */
  const projectRiders = useMemo(
    () => ridersForProject(riders, view, projectViews),
    [riders, view, projectViews],
  );
  const counts = useMemo(() => projectCounts(riders, projectViews), [riders, projectViews]);
  const unassigned = useMemo(
    () => unassignedProjectCount(riders, projectViews),
    [riders, projectViews],
  );
  const rowTotals = useMemo(() => {
    const map = new Map<string, ReturnType<typeof projectRowTotals>>();
    for (const row of projectRiders)
      map.set(row.driverId, projectRowTotals(view, row, projectViews));
    return map;
  }, [projectRiders, view, projectViews]);
  const kpis = useMemo(
    () => projectKpis(view, projectRiders, projectViews),
    [projectRiders, view, projectViews],
  );
  const projectAuditRows = useMemo(() => {
    const ids = new Set(projectRiders.map((row) => row.driverId));
    return (audit.data ?? []).filter((row) => ids.has(row.driverId));
  }, [audit.data, projectRiders]);

  /**
   * Switching the card re-scopes everything on it: the column funnels, the sort,
   * the selection and the search belong to the project that was open, and carrying
   * a Keeta filter onto Americana would hide rows for a reason the operator cannot
   * see.
   */
  function changeView(next: PayrollProjectView) {
    if (next === view) return;
    setFilters({});
    setSort(null);
    setSearch("");
    setRect(null);
    setFillPreview(null);
    onViewChange?.(next);
  }

  const searched = useMemo(
    () => projectRiders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [projectRiders, search],
  );

  const visibleRows = useMemo(() => {
    const filtered = searched.filter((row) => {
      const values: Record<string, string | number | null> = {};
      for (const column of AO_LEAD_COLUMNS) values[column.id] = riderColumnValue(row, column.id, today);
      for (let i = 0; i < dates.length; i += 1) {
        values[dayColumnId(i)] = riderColumnValue(row, dayColumnId(i));
        values[dayOrdersColumnId(i)] = riderColumnValue(row, dayOrdersColumnId(i));
        values[workingHoursColumnId(i)] = riderColumnValue(row, workingHoursColumnId(i));
      }
      return rowMatchesColumnFilters(values, filters);
    });
    return sortByColumn(filtered, sort, (row, columnId) => riderColumnValue(row, columnId, today));
  }, [searched, filters, sort, dates.length, today]);

  const fallbackLabel = useCallback((key: string) => t(`riderCols.${key}`), [t]);

  const labelOf = (columnId: string) => {
    const riderColumn = AO_LEAD_COLUMNS.find((c) => c.id === columnId);
    if (riderColumn) return resolveColumnLabel(columnId, t(`riderCols.${riderColumn.labelKey}`), headingConfig);
    const dayMatch = /^([dow])(\d+)$/.exec(columnId);
    if (dayMatch) {
      const date = dates[Number(dayMatch[2]) - 1];
      const label = date ? isoDayLabel(date) : columnId;
      if (dayMatch[1] === "w") return t("ao.workingHoursColumn", { day: label });
      if (dayMatch[1] === "o") return t("ao.ordersColumn", { day: label });
      return t("ao.payrollColumn", { day: label });
    }
    return columnId;
  };
  const chips = activeFilterChips(filters, labelOf);

  function setFilter(columnId: string, next: ColumnFilters[string] | null) {
    setFilters((prev) => {
      const copy = { ...prev };
      if (!next || !columnFilterActive(next)) delete copy[columnId];
      else copy[columnId] = next;
      return copy;
    });
  }

  const dayValues = useMemo(() => {
    const map = new Map<string, string[]>();
    for (let i = 0; i < dates.length; i += 1) {
      const statusId = dayColumnId(i);
      const ordersId = dayOrdersColumnId(i);
      const hoursId = workingHoursColumnId(i);
      const statusSet = new Set<string>();
      const orderSet = new Set<string>();
      const hoursSet = new Set<string>();
      for (const row of projectRiders) {
        const status = riderColumnValue(row, statusId);
        if (typeof status === "string" && status) statusSet.add(status);
        const orders = riderColumnValue(row, ordersId);
        if (orders !== null) orderSet.add(String(orders));
        const hours = riderColumnValue(row, hoursId);
        if (hours !== null) hoursSet.add(String(hours));
      }
      map.set(statusId, [...statusSet]);
      map.set(ordersId, [...orderSet]);
      map.set(hoursId, [...hoursSet]);
    }
    return map;
  }, [projectRiders, dates.length]);

  const dayColumnCount = config.dayColumns.length;
  const columnCount = columns.length + dates.length * dayColumnCount + 3;

  const contextFor = useCallback(
    (row: PayrollRiderRow | undefined, dayIndex: number) => {
      if (!row) return null;
      const info = row.dayInfo[dayIndex];
      return {
        riderName: row.name,
        amId: row.amId,
        date: dates[dayIndex] ?? "",
        zone: row.zone,
        zoneCategory: row.zoneCategory,
        orders: info?.orders ?? 0,
        hours: info?.loggedHours ?? 0,
      };
    },
    [dates],
  );

  const autoFor = useCallback((row: PayrollRiderRow | undefined, dayIndex: number) => {
    const info = row?.dayInfo[dayIndex];
    if (!info) return null;
    return {
      status: info.autoStatus,
      hours: info.autoHours,
      ruleIndex: info.autoRuleIndex,
      ruleLabel: info.autoRuleLabel,
    };
  }, []);

  const openFor = useCallback(
    (
      inputs: ReadonlyArray<{ driverId: string; date: string; text: string; currentHours: number }>,
      mode: "click" | "select" | "fill" | "paste",
      empty: string,
      first?: { row: PayrollRiderRow; dayIndex: number },
    ) => {
      session.openAdjust(inputs, mode, empty, first, {
        auto: first ? autoFor(first.row, first.dayIndex) : null,
        context: first ? contextFor(first.row, first.dayIndex) : null,
      });
    },
    [autoFor, contextFor, session],
  );

  const endDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    const current = rectRef.current;
    if (!active || !current) {
      setFillPreview(null);
      return;
    }
    if (active.mode === "fill") {
      const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
      let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
      const visibleIds = new Set(visibleRows.map((row) => row.driverId));
      const byId = new Map(visibleRows.map((row) => [row.driverId, row]));
      for (const target of visibleFillTargets(
        fillTargetCells(
          { r0: active.r0, c0: active.c0, r1: active.r1, c1: active.c1 },
          current.r1,
          current.c1,
        ),
        active.rowIds,
        visibleIds,
      )) {
        const sourceRow = byId.get(active.rowIds[target.srcR] ?? "");
        const targetRow = byId.get(active.rowIds[target.r] ?? "");
        if (!sourceRow || !targetRow) continue;
        if (target.srcC < 0 || target.srcC >= dates.length || target.c < 0 || target.c >= dates.length) continue;
        inputs.push(
          dayAdjustmentInput(targetRow, target.c, dates[target.c] ?? "", dayClipboardToken(sourceRow, target.srcC)),
        );
        first ??= { row: targetRow, dayIndex: target.c };
      }
      setFillPreview(null);
      openFor(inputs, "fill", t("adjust.nothingFilled"), first);
      return;
    }
    const moved = current.r0 !== current.r1 || current.c0 !== current.c1;
    const bounds = normalizeRect(current);
    const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
    let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
    const byId = new Map(visibleRows.map((row) => [row.driverId, row]));
    for (let r = bounds.top; r <= bounds.bottom; r += 1) {
      const row = byId.get(active.rowIds[r] ?? "");
      if (!row) continue;
      for (let c = bounds.left; c <= bounds.right; c += 1) {
        if (c < 0 || c >= dates.length) continue;
        inputs.push(dayAdjustmentInput(row, c, dates[c] ?? ""));
        first ??= { row, dayIndex: c };
      }
    }
    openFor(inputs, moved ? "select" : "click", t("adjust.nothingSelected"), first);
  }, [visibleRows, dates, openFor, t]);

  endDragRef.current = endDrag;
  gridMetricsRef.current = { rowCount: visibleRows.length, colCount: dates.length };

  const applyHoverCell = useCallback((row: number, columnIndex: number) => {
    const active = drag.current;
    if (!active) return;
    setRect((current) =>
      current
        ? { ...current, r1: row, c1: columnIndex }
        : { r0: active.r0, c0: active.c0, r1: row, c1: columnIndex },
    );
    if (active.mode === "fill") {
      setFillPreview({
        r0: Math.min(active.r0, row),
        c0: Math.min(active.c0, columnIndex),
        r1: Math.max(active.r1, row),
        c1: Math.max(active.c1, columnIndex),
      });
    }
  }, []);

  const beginEdgeDrag = useCallback(
    (cellEl: HTMLElement, selectableCol: number, clientX: number, clientY: number) => {
      const container = parentRef.current;
      if (!container) return;
      const crect = container.getBoundingClientRect();
      const thead = container.querySelector("thead");
      const next = cellEl.nextElementSibling instanceof HTMLElement ? cellEl.nextElementSibling : null;
      const metrics = gridMetricsRef.current;
      layoutRef.current = layoutFromSampleCell({
        containerLeft: crect.left,
        containerTop: crect.top,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
        headerHeight: thead?.getBoundingClientRect().height ?? 0,
        cellLeft: cellEl.getBoundingClientRect().left,
        cellWidth: cellEl.offsetWidth,
        cellHeight: cellEl.offsetHeight,
        cellCol: selectableCol,
        rowCount: metrics.rowCount,
        colCount: metrics.colCount,
        colStride: next ? cellEl.offsetWidth + next.offsetWidth : undefined,
      });
      dragStopRef.current?.();
      dragStopRef.current = startGridEdgeScroll({
        getContainer: () => parentRef.current,
        getLayout: () => {
          const current = layoutRef.current;
          if (!current) return null;
          const nextMetrics = gridMetricsRef.current;
          return { ...current, rowCount: nextMetrics.rowCount, colCount: nextMetrics.colCount };
        },
        onHover: applyHoverCell,
        onEnd: () => {
          dragStopRef.current = null;
          endDragRef.current();
        },
        clientX,
        clientY,
      });
    },
    [applyHoverCell],
  );

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(
    () => () => {
      dragStopRef.current?.();
      dragStopRef.current = null;
    },
    [],
  );

  const bounds = rect ? normalizeRect(rect) : null;
  const fillBounds = fillPreview ? normalizeRect(fillPreview) : null;
  const isSelected = (r: number, c: number) =>
    Boolean(bounds && r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right);
  const isFillTarget = (r: number, c: number) =>
    Boolean(
      fillBounds &&
        r >= fillBounds.top &&
        r <= fillBounds.bottom &&
        c >= fillBounds.left &&
        c <= fillBounds.right &&
        !isSelected(r, c),
    );

  const copy = useCallback(async () => {
    const current = rectRef.current;
    if (!current) return;
    const box = normalizeRect(current);
    const lines: string[] = [];
    for (let r = box.top; r <= box.bottom; r += 1) {
      const row = visibleRows[r];
      if (!row) continue;
      const line: string[] = [];
      for (let c = box.left; c <= box.right; c += 1) {
        line.push(c >= 0 && c < dates.length ? dayClipboardToken(row, c) : "");
      }
      lines.push(line.join("\t"));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      session.onNotice(t("adjust.copied", { count: lines.length }));
    } catch {
      session.onNotice(t("adjust.pasteFailed"));
    }
  }, [visibleRows, dates.length, session, t]);

  const paste = useCallback(async () => {
    const current = rectRef.current;
    if (!current || !editable) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        session.onNotice(t("adjust.nothingPasted"));
        return;
      }
      const matrix = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.split("\t"));
      const box = normalizeRect(current);
      const tiled = tilePasteOntoSelection(matrix, box.bottom - box.top + 1, box.right - box.left + 1);
      const inputs: ReturnType<typeof dayAdjustmentInput>[] = [];
      let first: { row: PayrollRiderRow; dayIndex: number } | undefined;
      for (let r = 0; r < tiled.length; r += 1) {
        const row = visibleRows[box.top + r];
        if (!row) break;
        for (let c = 0; c < tiled[r].length; c += 1) {
          const dayIndex = box.left + c;
          if (dayIndex < 0 || dayIndex >= dates.length) continue;
          inputs.push(dayAdjustmentInput(row, dayIndex, dates[dayIndex] ?? "", tiled[r][c]));
          first ??= { row, dayIndex };
        }
      }
      openFor(inputs, "paste", t("adjust.nothingPasted"), first);
    } catch {
      session.onNotice(t("adjust.pasteFailed"));
    }
  }, [editable, visibleRows, dates, openFor, session, t]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!editable) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      setRect(null);
      setFillPreview(null);
      return;
    }
    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copy();
    }
    if (mod && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void paste();
    }
  }

  return (
    <div className="space-y-2">
      <PayrollProjectCards
        view={view}
        views={projectViews}
        counts={counts}
        onSelect={changeView}
      />
      {unassigned > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("projects.unassigned", { count: unassigned })}
        </p>
      ) : null}
      <PayrollProjectKpis view={view} views={projectViews} kpis={kpis} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 shadow-sm">
          <b>{t("ao.bannerTitle")}</b>{" "}
          {config.label ? t("ao.banner.custom") : t(`ao.banner.${config.labelKey}`)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={session.undoCount === 0 || session.pending}
              onClick={() => session.undo()}
            >
              <Undo2 className="size-3.5" />
              {t("adjust.undo")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={session.redoCount === 0 || session.pending}
              onClick={() => session.redo()}
            >
              <Redo2 className="size-3.5" />
              {t("adjust.redo")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="me-1 size-3.5" />
              {t("upload.open", {
                figure: config.usesUploadedHours ? t("upload.hoursColumn") : t("upload.ordersColumn"),
              })}
            </Button>
            </>
          ) : null}
        </div>
      </div>
      <PayrollListToolbar
        prefKey="payroll-ao"
        search={search}
        onSearchChange={setSearch}
        prefs={listPrefs}
        onUpdate={updateListPrefs}
        trailing={
          <ColumnOrderMenu
            columns={leadColumns}
            labelFor={labelOf}
            labels={{
              columns: t("columnsMenu.columns"),
              title: t("columnsMenu.title"),
              hint: t("columnsMenu.hint"),
              pinned: t("columnsMenu.pinnedAo"),
              drag: t("columnsMenu.drag"),
              show: t("columnsMenu.show"),
              hide: t("columnsMenu.hide"),
              reset: t("columnsMenu.reset"),
            }}
          />
        }
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {chips.length || sort ? (
          <div className="border-b border-border px-3 py-2">
            <PayrollFilterChips
              prefix={t("columnFiltersPrefix")}
              chips={chips}
              sortLabel={
                sort
                  ? t("sortedBy", {
                      column: labelOf(sort.columnId),
                      dir: sort.dir === "asc" ? t("sortAsc") : t("sortDesc"),
                    })
                  : null
              }
              onClear={() => {
                setFilters({});
                setSort(null);
              }}
              onRemove={(columnId) => setFilter(columnId, null)}
              clearLabel={t("clearColumnFilters")}
            />
          </div>
        ) : null}
        {listPrefs.viewMode === "cards" ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <PayrollRiderCards
              rows={visibleRows.map((row) => ({
                id: row.driverId,
                code: row.amId || "—",
                name: row.name || "—",
                driverId: row.driverId,
                fields: [
                  { label: t("riderCols.mgId"), value: row.mgId || "—" },
                  { label: t("riderCols.restaurant"), value: row.restaurant || "—" },
                  { label: t("ao.workedDaysShort"), value: String(rowTotals.get(row.driverId)?.workedDays ?? 0) },
                  {
                    label: config.usesUploadedHours ? t("ao.totalHoursShort") : t("ao.totalOrdersShort"),
                    value: config.usesUploadedHours
                      ? (rowTotals.get(row.driverId)?.totalHours ?? 0).toFixed(1)
                      : String(rowTotals.get(row.driverId)?.totalOrders ?? 0),
                  },
                ],
              }))}
              empty={t("emptyRiders")}
            />
          </div>
        ) : (
        <div
          ref={parentRef}
          tabIndex={editable ? 0 : undefined}
          onKeyDown={onKeyDown}
          className={cn(
            "max-h-[min(560px,62dvh)] overflow-auto outline-none",
            editable && "focus-visible:ring-2 focus-visible:ring-primary/40",
          )}
        >
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                {columns.map((column, index) => {
                  const sticky = stickyIdentityStyle(
                    column.id,
                    Math.max(columnOffsets[index] ?? 0, 0),
                    "head",
                    index === frozenCount - 1,
                  );
                  return (
                  <th
                    key={column.id}
                    rowSpan={2}
                    className={cn(TABLE_HEAD_CLASS, "px-2 py-2 text-start align-bottom", sticky?.className)}
                    style={sticky?.style}
                  >
                    <PayrollColumnHeader
                      label={resolveColumnLabel(
                        column.id,
                        payrollColumnLabel(column.id, t(`riderCols.${column.labelKey}`)),
                        headingConfig,
                      )}
                      heading={
                        <PayrollHeadingLabel
                          columnKey={column.id}
                          fallback={payrollColumnLabel(column.id, t(`riderCols.${column.labelKey}`))}
                          config={headingConfig}
                          canManage={canManage}
                        />
                      }
                      columnId={column.id}
                      values={searched.map((row) => String(riderColumnValue(row, column.id, today) ?? ""))}
                      fixedList={column.id === "status" ? statusList : undefined}
                      filter={filters[column.id]}
                      onChange={(next) => setFilter(column.id, next)}
                      sort={sort}
                      onSort={setSort}
                      numeric={column.numeric}
                      className="border-0 p-0"
                    />
                  </th>
                  );
                })}
                {dates.map((date) => (
                  <th
                    key={date}
                    colSpan={dayColumnCount}
                    className={cn(TABLE_HEAD_CLASS, "border-s border-border px-2 py-1.5 text-center text-xs")}
                  >
                    {isoDayLabel(date)}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border">
                {dates.map((date, i) => (
                  <Fragment key={date}>
                    {config.dayColumns.map((dayColumn, position) => {
                      const columnId =
                        dayColumn === "payroll"
                          ? dayColumnId(i)
                          : dayColumn === "orders"
                            ? dayOrdersColumnId(i)
                            : workingHoursColumnId(i);
                      return (
                        <th
                          key={`${date}-${dayColumn}`}
                          className={cn(
                            TABLE_HEAD_CLASS,
                            "px-1 py-1",
                            position === 0 && "border-s border-border",
                          )}
                        >
                          <PayrollColumnHeader
                            label={t(dayColumnLabelKey(dayColumn))}
                            columnId={columnId}
                            values={dayValues.get(columnId) ?? []}
                            filter={filters[columnId]}
                            onChange={(next) => setFilter(columnId, next)}
                            sort={sort}
                            onSort={setSort}
                            numeric={dayColumn !== "payroll"}
                            className="border-0 p-0"
                          />
                        </th>
                      );
                    })}
                  </Fragment>
                ))}
                {/* The two row totals close every row, so they need a header of
                    their own — the project decides which pair they are. */}
                <th className={cn(TABLE_HEAD_CLASS, "border-s border-border px-2 py-1 text-end")}>
                  {t("ao.workedDaysShort")}
                </th>
                <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1 text-end")}>
                  {config.usesUploadedHours ? t("ao.totalHoursShort") : t("ao.totalOrdersShort")}
                </th>
                <th
                  key="row-action"
                  rowSpan={2}
                  scope="col"
                  aria-label={t("common.openEmployee")}
                  className={cn(TABLE_HEAD_CLASS, "w-9 px-1 py-2 text-center align-bottom")}
                />
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("emptyRiders")}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row, rowIndex) => (
                  <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                    {columns.map((column, index) => {
                      const sticky = stickyIdentityStyle(
                        column.id,
                        Math.max(columnOffsets[index] ?? 0, 0),
                        "cell",
                        index === frozenCount - 1,
                      );
                      return (
                      <td
                        key={column.id}
                        className={cn("whitespace-nowrap px-2 py-1.5", sticky?.className, column.id === "name" && "font-medium")}
                        style={sticky?.style}
                      >
                        {column.id === "serial" ? (
                          <span className="tabular-nums text-muted-foreground">{rowIndex + 1}</span>
                        ) : column.id === "zoneCategory" ? (
                          <ZoneCategoryPill category={row.zoneCategory} />
                        ) : column.id === "status" ? (
                          <PayrollStatusCell row={row} today={today} canEdit={editable} />
                        ) : column.id === "actualHours" ? (
                          row.actualHours.toFixed(2)
                        ) : payrollAssignField(column.id) ? (
                          <PayrollAssignCell
                            row={row}
                            field={payrollAssignField(column.id)!}
                            canEdit={editable}
                          />
                        ) : payrollIdentityField(column.id) ? (
                          <PayrollIdentityCell
                            driverId={row.driverId}
                            field={payrollIdentityField(column.id)!}
                            value={payrollIdentityValue(row, payrollIdentityField(column.id)!)}
                            canEdit={editable}
                          />
                        ) : (
                          String(riderColumnValue(row, column.id, today) ?? "—")
                        )}
                      </td>
                      );
                    })}
                    {dates.map((date, i) => {
                      const status = row.days[i] ?? "blank";
                      const info = row.dayInfo[i];
                      const adjusted = Boolean(info?.adjusted);
                      const orders = aoShownOrders(info, status);
                      const selected = isSelected(rowIndex, i);
                      return (
                        <Fragment key={`${row.driverId}-${date}`}>
                          {config.dayColumns.map((dayColumn, position) => {
                            const borderStart = position === 0 ? "border-s border-border/60" : undefined;
                            if (dayColumn === "payroll") {
                              return (
                                <td
                                  key="payroll"
                                  data-r={rowIndex}
                                  data-c={i}
                                  className={cn(
                                    "relative border-s border-border/60 px-1 py-1 text-center select-none",
                                    selected && "ring-2 ring-inset ring-primary/60",
                                    isFillTarget(rowIndex, i) && "outline-dashed outline-1 outline-emerald-500",
                                  )}
                                  onContextMenu={
                                    editable
                                      ? (event) => {
                                          event.preventDefault();
                                          session.rememberAnchor(event.currentTarget);
                                          setMenu({
                                            x: event.clientX,
                                            y: event.clientY,
                                            driverId: row.driverId,
                                            date,
                                          });
                                        }
                                      : undefined
                                  }
                                  onMouseDown={
                                    editable
                                      ? (event) => {
                                          if (event.button !== 0) return;
                                          event.preventDefault();
                                          session.rememberAnchor(event.currentTarget);
                                          const next = { r0: rowIndex, c0: i, r1: rowIndex, c1: i };
                                          drag.current = {
                                            mode: "select",
                                            ...next,
                                            rowIds: visibleRows.map((item) => item.driverId),
                                          };
                                          setRect(next);
                                          setFillPreview(null);
                                          beginEdgeDrag(event.currentTarget, i, event.clientX, event.clientY);
                                        }
                                      : undefined
                                  }
                                  onMouseEnter={
                                    editable
                                      ? () => {
                                          applyHoverCell(rowIndex, i);
                                        }
                                      : undefined
                                  }
                                >
                                  <span
                                    className={cn(
                                      "relative inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 text-xs font-semibold",
                                      dayClass(status, row.jobEndDescription),
                                      adjusted && "outline outline-2 outline-orange-400",
                                    )}
                                  >
                                    {cellParticular(row, i) || "—"}
                                    {adjusted ? (
                                      <span className="absolute end-0 top-0 size-0 border-e-[6px] border-t-[6px] border-e-transparent border-t-orange-500" />
                                    ) : null}
                                  </span>
                                  {editable && selected && bounds?.bottom === rowIndex && bounds?.right === i ? (
                                    <PayrollFillHandle
                                      onMouseDown={(event) => {
                                        if (event.button !== 0) return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (!bounds) return;
                                        drag.current = {
                                          mode: "fill",
                                          r0: bounds.top,
                                          c0: bounds.left,
                                          r1: bounds.bottom,
                                          c1: bounds.right,
                                          rowIds: visibleRows.map((item) => item.driverId),
                                        };
                                        const cell = event.currentTarget.closest("td");
                                        if (cell) beginEdgeDrag(cell, bounds.right, event.clientX, event.clientY);
                                      }}
                                    />
                                  ) : null}
                                </td>
                              );
                            }
                            if (dayColumn === "orders") {
                              return (
                                <td key="orders" className="px-1 py-1 text-center tabular-nums">
                                  <PayrollOrderCell
                                    driverId={row.driverId}
                                    date={date}
                                    orders={
                                      info?.ordersOverridden
                                        ? (info.displayOrders ?? info.orders)
                                        : orders
                                    }
                                    overridden={Boolean(info?.ordersOverridden)}
                                    canEdit={editable}
                                  />
                                </td>
                              );
                            }
                            return (
                              <td
                                key={dayColumn}
                                className={cn("px-1 py-1 text-center tabular-nums", borderStart)}
                              >
                                <PayrollHoursCell
                                  info={info}
                                  editable={config.hoursEditable && editable}
                                  onEdit={() =>
                                    setHoursTarget({
                                      driverId: row.driverId,
                                      riderName: row.name,
                                      mgId: row.mgId,
                                      date,
                                      current:
                                        typeof info?.workingHours === "number"
                                          ? info.workingHours
                                          : null,
                                    })
                                  }
                                />
                              </td>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                    {/* Row totals — the pair the project's SOP names. */}
                    <td className="border-s border-border/60 px-2 py-1.5 text-end font-semibold tabular-nums">
                      {rowTotals.get(row.driverId)?.workedDays ?? 0}
                    </td>
                    <td className="px-2 py-1.5 text-end font-semibold tabular-nums">
                      {config.usesUploadedHours
                        ? (rowTotals.get(row.driverId)?.totalHours ?? 0).toFixed(1)
                        : (rowTotals.get(row.driverId)?.totalOrders ?? 0)}
                    </td>
                    <td className="w-9 px-1 py-1.5 text-center">
                      <PayrollRowLink driverId={row.driverId} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            {t("ao.footNote")}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("tableFootRange", {
                shown: visibleRows.length,
                total: projectRiders.length,
                range: month.label,
              })}
            </span>
            {canExport ? (
              <button
                type="button"
                onClick={() =>
                  exportPayrollAttendanceOrdersProjectCsv(month.dates, visibleRows, {
                    labels: exportLabelsFromConfig(headingConfig, fallbackLabel),
                    hidden: hiddenSetFor("ao", headingConfig),
                    today,
                    project: view,
                    clients: projectViews,
                    visibleLeadIds: columns.filter((column) => column.id !== "serial").map((column) => column.id),
                    fileName: projectExportName(view, month.key, projectViews),
                  })
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold transition-colors hover:bg-muted/50"
              >
                <Download className="size-3.5" />
                {t("exportProject", { project: config.label ?? t(`projects.${config.labelKey}`) })}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <PayrollManualChangesPanel
        rows={projectAuditRows}
        title={t("manualChanges.title")}
        hint={t("manualChanges.hintProject", {
          project: config.label ?? t(`projects.${config.labelKey}`),
        })}
        prefKey="payroll.manualChanges.ao"
        labels={{
          when: t("manualChanges.when"),
          who: t("manualChanges.who"),
          rider: t("manualChanges.rider"),
          day: t("manualChanges.day"),
          original: t("manualChanges.original"),
          adjusted: t("manualChanges.adjusted"),
          reason: t("manualChanges.reason"),
          empty: t("manualChanges.empty"),
          entity: t("manualChanges.title"),
        }}
      />

      <PayrollDailyUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        view={view}
        views={projectViews}
        riders={projectRiders}
        monthPrefix={month.key}
        today={today}
      />
      <PayrollHoursDialog
        target={hoursTarget}
        today={today}
        onClose={() => setHoursTarget(null)}
      />
      <PayrollCellMenu
        state={menu}
        onClose={() => setMenu(null)}
        onEdit={() => {
          if (!menu) return;
          const rowIndex = visibleRows.findIndex((row) => row.driverId === menu.driverId);
          const dayIndex = dates.indexOf(menu.date);
          const row = visibleRows[rowIndex];
          setMenu(null);
          if (!row || dayIndex < 0) return;
          openFor(
            [
              {
                driverId: row.driverId,
                date: menu.date,
                text: dayClipboardToken(row, dayIndex),
                currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
              },
            ],
            "click",
            t("adjust.nothingSelected"),
            { row, dayIndex },
          );
        }}
        onHistory={() => {
          if (!menu) return;
          const rowIndex = visibleRows.findIndex((row) => row.driverId === menu.driverId);
          const dayIndex = dates.indexOf(menu.date);
          const row = visibleRows[rowIndex];
          setMenu(null);
          if (!row || dayIndex < 0) return;
          openFor(
            [
              {
                driverId: row.driverId,
                date: menu.date,
                text: dayClipboardToken(row, dayIndex),
                currentHours: row.dayInfo[dayIndex]?.creditedHours ?? 0,
              },
            ],
            "click",
            t("adjust.nothingSelected"),
            { row, dayIndex },
          );
        }}
      />
    </div>
  );
}
