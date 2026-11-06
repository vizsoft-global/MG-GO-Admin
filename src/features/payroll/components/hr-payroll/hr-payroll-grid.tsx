"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { HR_FOOTER_KEYS, HR_GROUP_FILL, hrColumnIsNumeric, hrGroupSpans } from "../../hr-payroll-columns";
import type { HrColumn } from "../../hr-payroll-columns";
import { HR_AWAITING, hrFooterTotals, hrSalaryShortfall } from "../../hr-payroll-formulas";
import { HR_STATUS_ORDER, hrStatusPaint, hrStatusStyle } from "../../hr-payroll-status";
import type { HrEditState, HrGroupBy, HrPayrollGroup, HrPayrollRow } from "../../hr-payroll-types";
import {
  PayrollColumnHeader,
  type ColumnFilterValue,
  type ColumnSort,
} from "../../payroll-column-filter";
import type { PayrollCellStatus } from "../../use-payroll-cell-mutation";
import type { HrNumericCell } from "../../hr-cell-validation";
import { COLUMN_EDIT, money3 } from "./hr-payroll-ui";
import { HrAmountCell, HrOptionCell, HrSelectCell, HrTextCell } from "./editable-cell";
import type { HrIdentityPatch } from "../../payroll-actions";
import { PayrollIdentityCell, hrIdentityField } from "../../payroll-identity-cell";
import { PayrollRowLink } from "../../payroll-row-link";
import "./hr-payroll.css";

/** Rows painted before the virtualiser has measured the scroll container. */
const FALLBACK_ROW_COUNT = 40;
/** Matches the virtualiser's `estimateSize` so the first paint does not jump. */
const FALLBACK_ROW_HEIGHT = 26;

function HrDataRow({
  row,
  index,
  columns,
  boxes,
  flash,
  canManage,
  awaiting,
  noRate,
  shortfallTitle,
  cellStates,
  cellError,
  vehicleOptions,
  noVehicle,
  noIdentity,
  onVehicleType,
  identityOptions,
  onIdentity,
  onSelect,
  onAmount,
}: {
  row: HrPayrollRow;
  index: number;
  columns: readonly HrColumn[];
  boxes: readonly HrStickyBox[];
  flash: boolean;
  canManage: boolean;
  awaiting: string;
  noRate: string;
  shortfallTitle: (gap: number) => string;
  cellStates: Readonly<Record<string, PayrollCellStatus>>;
  cellError: (reason: string | undefined) => string;
  vehicleOptions: readonly { key: string; label: string }[];
  identityOptions: { banks: { value: string; label: string }[]; zones: { value: string; label: string }[]; clients: { value: string; label: string }[] };
  noVehicle: string;
  noIdentity: string;
  onVehicleType: (driverId: string, vehicleKey: string) => void;
  onIdentity: (driverId: string, patch: HrIdentityPatch) => void;
  onSelect: (driverId: string, key: keyof HrEditState, value: number) => void;
  onAmount: (driverId: string, key: keyof HrEditState, value: number) => void;
}) {
  return (
    <tr className={flash ? "hrpay-flash" : undefined}>
      {columns.map((column, columnIndex) => {
        const paint = column.key === "name" ? hrStatusPaint(row.statusKey, row.jobEndDescription) : null;
        const sticky = boxes[columnIndex];
        const tone =
          paint && paint.fill !== "transparent" ? { background: paint.fill, color: paint.text } : undefined;
        return (
          <td
            key={column.key}
            className={withSticky("hrpay-cell", columnIndex)}
            style={tone ? { ...sticky, ...tone } : sticky}
          >
            {renderHrCell(
              column,
              row,
              index,
              canManage,
              awaiting,
              noRate,
              onSelect,
              onAmount,
              shortfallTitle,
              cellStates,
              cellError,
              vehicleOptions,
              noVehicle,
              noIdentity,
              onVehicleType,
              identityOptions,
              onIdentity,
            )}
          </td>
        );
      })}
      <td key="row-action" className="hrpay-cell w-9 text-center">
        <PayrollRowLink driverId={row.driverId} />
      </td>
    </tr>
  );
}

/**
 * One row of the HR sheet.
 *
 * Memoised on the row identity plus primitives, so a sort or a filter that only
 * re-orders rows does not rebuild every cell's className and sticky box.
 */
const HrRow = memo(HrDataRow);

export const HR_STICKY_COLUMNS = 4;

function stickyOnly(index: number): string | undefined {
  if (index === HR_STICKY_COLUMNS - 1) return "hrpay-sticky hrpay-edge";
  if (index < HR_STICKY_COLUMNS) return "hrpay-sticky";
  return undefined;
}

function withSticky(base: string, index: number): string {
  const sticky = stickyOnly(index);
  return sticky ? `${base} ${sticky}` : base;
}

/**
 * The inline box every frozen cell shares: the offset its column starts at and
 * the width the browser actually gave that column.
 *
 * The widths are **measured** (`measureStickyWidths`) and not the declared
 * `column.width`, because `table-layout: auto` may hand a column a few pixels
 * more than the design asked for when a cell is wider than it. A frozen cell
 * pinned to the declared width then either leaves a sliver of the columns
 * sliding underneath visible, or overlaps the next frozen cell — which is what
 * reads as "the frozen columns flicker" while scrolling.
 */
export type HrStickyBox = { left: number; insetInlineStart: number; width: number; minWidth: number; maxWidth: number };

function stickyBoxes(widths: readonly number[]): HrStickyBox[] {
  let at = 0;
  return widths.map((width) => {
    const box = { left: at, insetInlineStart: at, width, minWidth: width, maxWidth: width };
    at += width;
    return box;
  });
}

type HrSortMode = "az" | "za" | "small" | "large" | "colour";
type HrSort = { key: string; mode: HrSortMode };

function hrGroupValue(row: HrPayrollRow, groupBy: HrGroupBy): string {
  switch (groupBy) {
    case "company":
      return row.company;
    case "project":
    case "clientName":
      return row.project;
    case "section":
      return row.section;
    case "zone":
      return row.zone;
    case "vehicle":
      return row.cells.vtype ?? "";
    case "sponsor":
      return row.sponsor;
    case "rest":
      return row.cells.rest ?? "";
    case "status":
      return row.cells.status ?? "";
    case "natCat":
      return row.cells.natCat ?? "";
    case "hiring":
      return row.cells.hiring ?? "";
    case "none":
      return "";
    default: {
      const unreachable: never = groupBy;
      return unreachable;
    }
  }
}

function groupRank(row: HrPayrollRow, groupBy: HrGroupBy): string {
  if (groupBy === "status") {
    const index = (HR_STATUS_ORDER as readonly string[]).indexOf(row.statusKey);
    return String(index < 0 ? 99 : index).padStart(2, "0");
  }
  return hrGroupValue(row, groupBy);
}

function nextSort(column: HrColumn, current: HrSort | null): HrSort | null {
  const mode: HrSortMode | null = current?.key === column.key ? current.mode : null;
  if (column.key === "name" || column.key === "status") {
    switch (mode) {
      case null:
        return { key: column.key, mode: "colour" };
      case "colour":
        return { key: column.key, mode: "az" };
      case "az":
        return { key: column.key, mode: "za" };
      case "za":
        return null;
      case "small":
      case "large":
        return { key: column.key, mode: "colour" };
      default: {
        const unreachable: never = mode;
        return unreachable;
      }
    }
  }
  if (hrColumnIsNumeric(column)) {
    switch (mode) {
      case null:
        return { key: column.key, mode: "small" };
      case "small":
        return { key: column.key, mode: "large" };
      case "large":
        return null;
      case "colour":
      case "az":
      case "za":
        return { key: column.key, mode: "small" };
      default: {
        const unreachable: never = mode;
        return unreachable;
      }
    }
  }
  switch (mode) {
    case null:
      return { key: column.key, mode: "az" };
    case "az":
      return { key: column.key, mode: "za" };
    case "za":
      return null;
    case "colour":
    case "small":
    case "large":
      return { key: column.key, mode: "az" };
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function sortMark(mode: HrSortMode): string {
  switch (mode) {
    case "az":
      return " A–Z";
    case "za":
      return " Z–A";
    case "small":
      return " ↑";
    case "large":
      return " ↓";
    case "colour":
      return " ●";
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function firstNumber(text: string): number {
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function compareSorted(a: HrPayrollRow, b: HrPayrollRow, key: string, mode: HrSortMode): number {
  switch (mode) {
    case "colour": {
      const order = HR_STATUS_ORDER as readonly string[];
      const left = order.indexOf(a.statusKey);
      const right = order.indexOf(b.statusKey);
      return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
    }
    case "small":
    case "large": {
      const delta = firstNumber(a.cells[key] ?? "") - firstNumber(b.cells[key] ?? "");
      return mode === "small" ? delta : -delta;
    }
    case "az":
    case "za": {
      const delta = (a.cells[key] ?? "").localeCompare(b.cells[key] ?? "", undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return mode === "az" ? delta : -delta;
    }
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

function funnelSortOf(sort: HrSort | null): ColumnSort {
  if (!sort) return null;
  switch (sort.mode) {
    case "az":
    case "small":
      return { columnId: sort.key, dir: "asc" };
    case "za":
    case "large":
      return { columnId: sort.key, dir: "desc" };
    case "colour":
      return null;
    default: {
      const unreachable: never = sort.mode;
      return unreachable;
    }
  }
}

function applyFunnelSort(column: HrColumn, next: ColumnSort): HrSort | null {
  if (!next || next.columnId !== column.key) return null;
  if (hrColumnIsNumeric(column)) {
    return { key: column.key, mode: next.dir === "asc" ? "small" : "large" };
  }
  return { key: column.key, mode: next.dir === "asc" ? "az" : "za" };
}

function columnFilterValues(
  column: HrColumn,
  sourceRows: readonly HrPayrollRow[],
  awaiting: string,
): string[] {
  if (column.key === "i") {
    return sourceRows.map((_, index) => String(index + 1));
  }
  return sourceRows.map((row) => {
    const raw = row.cells[column.key] ?? "";
    if (raw === HR_AWAITING) return awaiting;
    return raw === "—" ? "" : raw;
  });
}

function footerMoney(
  key: string,
  totals: ReturnType<typeof hrFooterTotals>,
): string | null {
  for (const footerKey of HR_FOOTER_KEYS) {
    if (footerKey === key) return money3(totals[footerKey]);
  }
  return null;
}

function renderHrCell(
  column: HrColumn,
  row: HrPayrollRow,
  dataIndex: number,
  canManage: boolean,
  awaiting: string,
  noRate: string,
  onSelect: (driverId: string, key: keyof HrEditState, value: number) => void,
  onAmount: (driverId: string, key: keyof HrEditState, value: number) => void,
  shortfallTitle: (gap: number) => string,
  cellStates: Readonly<Record<string, PayrollCellStatus>>,
  cellError: (reason: string | undefined) => string,
  vehicleOptions: readonly { key: string; label: string }[],
  noVehicle: string,
  noIdentity: string,
  onVehicleType: (driverId: string, vehicleKey: string) => void,
  identityOptions: { banks: { value: string; label: string }[]; zones: { value: string; label: string }[]; clients: { value: string; label: string }[] },
  onIdentity: (driverId: string, patch: HrIdentityPatch) => void,
): JSX.Element | string | number {
  if (column.key === "i") return dataIndex;
  if (column.key === "status") {
    const paint = hrStatusPaint(row.statusKey, row.jobEndDescription);
    return (
      <span className="hrpay-chip" style={hrStatusStyle(paint)}>
        {row.cells.status}
      </span>
    );
  }
  if (column.key === "vtype" && canManage) {
    // A rider on a type the catalog no longer lists keeps that string in the
    // cell: deleting a type must never blank somebody's vehicle.
    const known = vehicleOptions.some((option) => option.key === row.vehicleKey);
    return (
      <select
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-input focus-visible:border-input"
        value={row.vehicleKey}
        aria-label={column.header}
        onChange={(event) => onVehicleType(row.driverId, event.target.value)}
      >
        {!known ? <option value={row.vehicleKey}>{row.vehicleKey || noVehicle}</option> : null}
        {vehicleOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  /**
   * The identity cells the client asked to correct from the sheet: bank number,
   * bank, currency, zone and client. Each one writes through the audited callable
   * and keeps the row's dependent figures in step.
   */
  if (canManage && (column.key === "bankNo" || column.key === "cur")) {
    const field = column.key === "bankNo" ? "bankNumber" : "currency";
    const raw = row.cells[column.key] ?? "";
    return (
      <HrTextCell
        driverId={row.driverId}
        field={field}
        columnKey={column.key}
        value={raw === "—" ? "" : raw}
        status={cellStates[`${row.driverId}:${field}`] ?? { state: "idle" }}
        errorText={cellError}
        canEdit={canManage}
        onCommit={(driverId, changed, value) => onIdentity(driverId, { [changed]: value })}
      />
    );
  }
  if (canManage && (column.key === "bank" || column.key === "zone" || column.key === "clientName")) {
    const spec =
      column.key === "bank"
        ? { field: "bankCode" as const, value: row.bankCode, options: identityOptions.banks }
        : column.key === "zone"
          ? { field: "zoneId" as const, value: row.zoneId, options: identityOptions.zones }
          : { field: "projectKey" as const, value: row.projectKey, options: identityOptions.clients };
    return (
      <HrOptionCell
        value={spec.value}
        options={spec.options}
        emptyLabel={noIdentity}
        ariaLabel={column.header}
        status={cellStates[`${row.driverId}:${spec.field}`] ?? { state: "idle" }}
        errorText={cellError}
        canEdit={canManage}
        onCommit={(value) => onIdentity(row.driverId, { [spec.field]: value })}
      />
    );
  }
  const editKey = COLUMN_EDIT[column.key];
  if (column.editable === "select" && canManage && editKey && column.select) {
    return (
      <HrSelectCell
        driverId={row.driverId}
        field={editKey as HrNumericCell}
        value={row.edit[editKey]}
        column={column}
        status={cellStates[`${row.driverId}:${editKey}`] ?? { state: "idle" }}
        errorText={cellError}
        canEdit={canManage}
        onCommit={onSelect}
      />
    );
  }
  if (column.editable === "amount" && canManage && editKey) {
    return (
      <HrAmountCell
        driverId={row.driverId}
        field={editKey as HrNumericCell}
        columnKey={column.key}
        display={row.cells[column.key] ?? ""}
        current={row.edit[editKey]}
        status={cellStates[`${row.driverId}:${editKey}`] ?? { state: "idle" }}
        errorText={cellError}
        canEdit={canManage}
        onCommit={onAmount}
      />
    );
  }
  const identityField = hrIdentityField(column.key);
  if (identityField) {
    const value =
      identityField === "clientId"
        ? row.identityEdit.clientId
        : identityField === "employeeId"
          ? row.identityEdit.employeeId
          : identityField === "fullName"
            ? row.identityEdit.fullName
            : row.identityEdit.restaurantName;
    const paint = column.key === "name" ? hrStatusPaint(row.statusKey, row.jobEndDescription) : null;
    const tone = paint && paint.fill !== "transparent" ? { fill: paint.fill, text: paint.text } : undefined;
    return (
      <PayrollIdentityCell
        driverId={row.driverId}
        field={identityField}
        value={value}
        canEdit={false}
        tone={tone}
      />
    );
  }
  const text = row.cells[column.key] ?? "";
  if (text === HR_AWAITING) return <span className="hrpay-await">{awaiting}</span>;
  if (column.key === "rate" && text === noRate) return <span className="hrpay-warn">{text}</span>;
  if (column.key === "total") {
    // Req: a month that pays less than the work permit salary is flagged, not
    // silently printed. A permit figure of 0 is "not recorded", never "below".
    const gap = hrSalaryShortfall(row.numbers.totalSalary, row.permitSalary);
    if (gap !== null) {
      return (
        <span
          className="inline-flex rounded-sm bg-destructive/15 px-1 font-semibold text-destructive"
          title={shortfallTitle(gap)}
          aria-label={shortfallTitle(gap)}
        >
          {text}
        </span>
      );
    }
  }
  return text;
}

export function HrPayrollGrid(props: {
  columns: readonly HrColumn[];
  rows: readonly HrPayrollRow[];
  sourceRows: readonly HrPayrollRow[];
  filters: Readonly<Record<string, ColumnFilterValue>>;
  onFilter: (key: string, next: ColumnFilterValue | null) => void;
  groupBy: HrGroupBy;
  canManage: boolean;
  flash: ReadonlySet<string>;
  headers: Readonly<Record<string, string>>;
  groupLabels: Readonly<Record<HrPayrollGroup, string>>;
  awaiting: string;
  noRate: string;
  blank: string;
  totalRiders: string;
  empty: string;
  statusList: readonly string[];
  onSelect: (driverId: string, key: keyof HrEditState, value: number) => void;
  onAmount: (driverId: string, key: keyof HrEditState, value: number) => void;
  /** Sentence naming the shortfall against the work permit salary, in KWD. */
  shortfallTitle: (gap: number) => string;
  /** Per-cell save state, keyed `${driverId}:${editKey}`. */
  cellStates: Readonly<Record<string, PayrollCellStatus>>;
  /** A refused value's reason as a sentence. */
  cellError: (reason: string | undefined) => string;
  /** The live `vehicle_types` catalog, for the inline Vehicle Type cell. */
  vehicleOptions: readonly { key: string; label: string }[];
  /** Bank / Zone / Client catalogs for the identity cells. */
  identityOptions: { banks: { value: string; label: string }[]; zones: { value: string; label: string }[]; clients: { value: string; label: string }[] };
  /** Printed when a rider has no assignment. */
  noVehicle: string;
  noIdentity: string;
  onVehicleType: (driverId: string, vehicleKey: string) => void;
  onIdentity: (driverId: string, patch: HrIdentityPatch) => void;
  /** Pinned bar under the scroller (count + Download this table). */
  footer?: ReactNode;
  /** The rows exactly as painted, so the export can be the screen. */
  onOrderedRows?: (rows: readonly HrPayrollRow[]) => void;
}): JSX.Element {
  const [sort, setSort] = useState<HrSort | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const declaredWidths = useMemo(
    () => Array.from({ length: HR_STICKY_COLUMNS }, (_, index) => props.columns[index]?.width ?? 0),
    [props.columns],
  );
  const [measuredWidths, setMeasuredWidths] = useState<readonly number[]>([]);
  /**
   * The frozen cells must be pinned to the width the browser actually gave the
   * column, not the width the design asked for: `table-layout: auto` widens a
   * column when a cell is wider than its declared width, and a frozen cell
   * pinned to the smaller number leaves a sliver of the sliding columns visible
   * (or overlaps its neighbour), which is what reads as flicker while scrolling.
   */
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const read = () => {
      const header = table.tHead?.rows[1];
      if (!header) return;
      const next = declaredWidths.map((declared, index) => {
        const cell = header.cells[index];
        const width = cell ? Math.round(cell.getBoundingClientRect().width) : 0;
        return width > 0 ? width : declared;
      });
      setMeasuredWidths((current) =>
        current.length === next.length && current.every((width, index) => width === next[index]) ? current : next,
      );
    };
    read();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(table);
    return () => observer?.disconnect();
  }, [declaredWidths]);
  const stickyWidths = measuredWidths.length === declaredWidths.length ? measuredWidths : declaredWidths;
  const boxes = useMemo(() => stickyBoxes(stickyWidths), [stickyWidths]);
  const ordered = [...props.rows].sort((a, b) => {
    if (props.groupBy !== "none") {
      const group = groupRank(a, props.groupBy).localeCompare(groupRank(b, props.groupBy));
      if (group !== 0) return group;
    }
    if (!sort) return 0;
    return compareSorted(a, b, sort.key, sort.mode);
  });
  // The workbook must be the screen: same rows, same order (filters, grouping and
  // the header sort all live in this component).
  const reportOrdered = props.onOrderedRows;
  useEffect(() => {
    reportOrdered?.(ordered);
  }, [ordered, reportOrdered]);
  /**
   * Req 1.9: 962 riders x 51 columns is 49,062 `<td>` elements in one paint. The
   * ungrouped sheet virtualises its body — about 25 rows stay in the DOM — while
   * a grouped sheet keeps the plain body, because its banner rows have to sit
   * between data rows and a window would cut them.
   */
  const virtualise = props.groupBy === "none" && ordered.length > 40;
  const virtualizer = useVirtualizer({
    count: virtualise ? ordered.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 14,
  });
  const totals = hrFooterTotals(props.rows);
  const nameIndex = props.columns.findIndex((column) => column.key === "name");
  const riderLabelAt = nameIndex >= 0 ? nameIndex : 0;
  const body: JSX.Element[] = [];
  const renderRow = (row: HrPayrollRow, index: number) => (
    <HrRow
      key={row.driverId}
      row={row}
      index={index}
      columns={props.columns}
      boxes={boxes}
      flash={props.flash.has(row.driverId)}
      canManage={props.canManage}
      awaiting={props.awaiting}
      noRate={props.noRate}
      shortfallTitle={props.shortfallTitle}
      cellStates={props.cellStates}
      cellError={props.cellError}
      vehicleOptions={props.vehicleOptions}
      noVehicle={props.noVehicle}
      noIdentity={props.noIdentity}
      onVehicleType={props.onVehicleType}
      identityOptions={props.identityOptions}
      onIdentity={props.onIdentity}
      onSelect={props.onSelect}
      onAmount={props.onAmount}
    />
  );
  if (ordered.length === 0) {
    body.push(
      <tr key="empty">
        <td colSpan={props.columns.length + 1}>{props.empty}</td>
      </tr>,
    );
  } else if (virtualise) {
    const measured = virtualizer.getVirtualItems();
    // The virtualiser reads `scrollRef.current.clientHeight`, which is 0 until the
    // browser has laid the sheet out. On that first frame it reports no items, the
    // body rendered empty and only the sticky footer showed — the page looked like a
    // table with no rows. Paint the first screenful directly and let the measured
    // window take over the moment it exists.
    const unmeasured = measured.length === 0;
    const items = unmeasured
      ? ordered.slice(0, FALLBACK_ROW_COUNT).map((_, index) => ({
          index,
          start: index * FALLBACK_ROW_HEIGHT,
          end: (index + 1) * FALLBACK_ROW_HEIGHT,
        }))
      : measured;
    body.push(
      <tr key="pad-top" aria-hidden>
        <td colSpan={props.columns.length + 1} style={{ height: items[0]?.start ?? 0, padding: 0 }} />
      </tr>,
    );
    for (const item of items) {
      const row = ordered[item.index];
      if (row) body.push(renderRow(row, item.index + 1));
    }
    body.push(
      <tr key="pad-bottom" aria-hidden>
        <td
          colSpan={props.columns.length + 1}
          style={{
            height: unmeasured
              ? 0
              : Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)),
            padding: 0,
          }}
        />
      </tr>,
    );
  } else {
    let previous: string | null = null;
    let dataIndex = 0;
    for (const row of ordered) {
      if (props.groupBy !== "none") {
        const value = hrGroupValue(row, props.groupBy);
        if (value !== previous) {
          const shown = value && value !== "—" ? value : props.blank;
          body.push(
            <tr key={`group-${body.length}-${value}`} className="hrpay-group">
              <td colSpan={props.columns.length + 1}>{shown}</td>
            </tr>,
          );
          previous = value;
        }
      }
      dataIndex += 1;
      body.push(renderRow(row, dataIndex));
    }
  }
  // A band that crosses the frozen column boundary is split in two: the frozen
  // part (columns 0..3) is sticky, the rest scrolls. Leaving it as one cell made
  // the top band slide away from the pinned columns and paint over them.
  const bandCells: { group: HrPayrollGroup; count: number; start: number }[] = [];
  let bandStart = 0;
  for (const span of hrGroupSpans(props.columns)) {
    const start = bandStart;
    const end = bandStart + span.count;
    if (start < HR_STICKY_COLUMNS && end > HR_STICKY_COLUMNS) {
      bandCells.push({ group: span.group, count: HR_STICKY_COLUMNS - start, start });
      bandCells.push({ group: span.group, count: end - HR_STICKY_COLUMNS, start: HR_STICKY_COLUMNS });
    } else {
      bandCells.push({ group: span.group, count: span.count, start });
    }
    bandStart = end;
  }
  const bands = bandCells.map((cell) => {
    const sticky = cell.start < HR_STICKY_COLUMNS;
    const edge = sticky && cell.start + cell.count === HR_STICKY_COLUMNS;
    const bandClass = edge ? "hrpay-band hrpay-sticky hrpay-edge" : sticky ? "hrpay-band hrpay-sticky" : "hrpay-band";
    return (
      <th
        key={`${cell.group}-${cell.start}`}
        className={bandClass}
        colSpan={cell.count}
        style={
          sticky
            ? {
                background: HR_GROUP_FILL[cell.group],
                left: boxes[cell.start]?.left ?? 0,
                insetInlineStart: boxes[cell.start]?.insetInlineStart ?? 0,
              }
            : { background: HR_GROUP_FILL[cell.group] }
        }
      >
        {props.groupLabels[cell.group]}
      </th>
    );
  });
  return (
    <>
      <div className="hrpay-scroll" ref={scrollRef}>
        <table className="hrpay-table" ref={tableRef}>
          <thead>
            <tr>
              {bands}
              <th key="row-action-band" className="hrpay-band w-9" scope="col" aria-hidden />
            </tr>
            <tr>
              {props.columns.map((column, index) => (
                <PayrollColumnHeader
                  key={column.key}
                  label={props.headers[column.key] ?? column.header}
                  heading={
                    <button type="button" className="hrpay-sort" onClick={() => setSort((current) => nextSort(column, current))}>
                      {props.headers[column.key] ?? column.header}
                      {sort?.key === column.key ? sortMark(sort.mode) : ""}
                    </button>
                  }
                  columnId={column.key}
                  values={columnFilterValues(column, props.sourceRows, props.awaiting)}
                  fixedList={column.key === "status" ? props.statusList : undefined}
                  filter={props.filters[column.key]}
                  onChange={(next) => props.onFilter(column.key, next)}
                  sort={funnelSortOf(sort)}
                  onSort={(next) => setSort(applyFunnelSort(column, next))}
                  numeric={hrColumnIsNumeric(column)}
                  className={withSticky("hrpay-colhead", index)}
                  style={boxes[index]}
                />
              ))}
              <th key="row-action" className="hrpay-colhead w-9 text-center" scope="col" />
            </tr>
          </thead>
          <tbody>{body}</tbody>
          <tfoot>
            <tr className="hrpay-foot">
              {props.columns.map((column, index) => {
                const summed = footerMoney(column.key, totals);
                const text = index === riderLabelAt ? props.totalRiders : summed ?? "";
                return (
                  <td key={column.key} className={stickyOnly(index)} style={boxes[index]}>
                    {text}
                  </td>
                );
              })}
              <td key="row-action" className="w-9" />
            </tr>
          </tfoot>
        </table>
      </div>
      {props.footer}
    </>
  );
}
