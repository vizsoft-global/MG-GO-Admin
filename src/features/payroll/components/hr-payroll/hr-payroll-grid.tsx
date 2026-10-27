"use client";

import { useState, type JSX } from "react";
import { HR_FOOTER_KEYS, HR_GROUP_FILL, hrGroupSpans, stickyOffsets } from "../../hr-payroll-columns";
import type { HrColumn, HrColumnKind } from "../../hr-payroll-columns";
import { distinctHrValues, HR_AWAITING, hrColumnFilterMode, hrFooterTotals } from "../../hr-payroll-formulas";
import { HR_STATUS_ORDER, hrStatusPaint, hrStatusStyle } from "../../hr-payroll-status";
import type { HrEditState, HrGroupBy, HrPayrollGroup, HrPayrollRow } from "../../hr-payroll-types";
import { COLUMN_EDIT, money3, optionLabel } from "./hr-payroll-ui";
import { PayrollIdentityCell, hrIdentityField } from "../../payroll-identity-cell";
import "./hr-payroll.css";

function stickyOnly(index: number): string | undefined {
  if (index === 3) return "hrpay-sticky hrpay-edge";
  if (index < 4) return "hrpay-sticky";
  return undefined;
}

function withSticky(base: string, index: number): string {
  const sticky = stickyOnly(index);
  return sticky ? `${base} ${sticky}` : base;
}

function stickyBox(
  index: number,
  offsets: readonly number[],
  width: number,
): { insetInlineStart: number; width: number; minWidth: number } | undefined {
  if (index >= 4) return undefined;
  return { insetInlineStart: offsets[index] ?? 0, width, minWidth: width };
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

function numericKind(kind: HrColumnKind): boolean {
  switch (kind) {
    case "money":
    case "dec2":
    case "int":
    case "pct":
    case "index":
    case "select":
      return true;
    case "text":
      return false;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function numericColumn(column: HrColumn): boolean {
  switch (column.key) {
    case "mg":
    case "civil":
    case "client":
    case "rate":
      return true;
    default:
      return numericKind(column.kind);
  }
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
  if (numericColumn(column)) {
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

function hrFilterControl(
  column: HrColumn,
  sourceRows: readonly HrPayrollRow[],
  filters: Readonly<Record<string, string>>,
  all: string,
  awaiting: string,
  onFilter: (key: string, value: string) => void,
): JSX.Element | null {
  const mode = hrColumnFilterMode(column.key, sourceRows);
  switch (mode) {
    case "none":
      return null;
    case "contains":
      return (
        <input
          value={filters[column.key] ?? ""}
          onChange={(event) => onFilter(column.key, event.target.value)}
        />
      );
    case "exact":
      return (
        <select
          value={filters[column.key] ?? ""}
          onChange={(event) => onFilter(column.key, event.target.value)}
        >
          <option value="">{all}</option>
          {distinctHrValues(sourceRows, column.key).map((value) => (
            <option key={value} value={value}>
              {value === HR_AWAITING ? awaiting : value}
            </option>
          ))}
        </select>
      );
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
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

function HrAmountEditor(props: { display: string; current: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? props.display}
      onFocus={(event) => {
        const next = String(props.current);
        setDraft(next);
        event.currentTarget.value = next;
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        const trimmed = event.currentTarget.value.trim();
        const parsed = Number(trimmed);
        if (trimmed !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed !== props.current) {
          props.onCommit(parsed);
        }
        setDraft(null);
      }}
    />
  );
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
  const editKey = COLUMN_EDIT[column.key];
  if (column.editable === "select" && canManage && editKey && column.select) {
    const selected = editKey;
    return (
      <select
        value={String(row.edit[selected])}
        onChange={(event) => onSelect(row.driverId, selected, Number(event.target.value))}
      >
        {column.select.map((value) => (
          <option key={value} value={String(value)}>
            {optionLabel(value, column)}
          </option>
        ))}
      </select>
    );
  }
  if (column.editable === "amount" && canManage && editKey) {
    const amountKey = editKey;
    return (
      <HrAmountEditor
        display={row.cells[column.key] ?? ""}
        current={row.edit[amountKey]}
        onCommit={(value) => onAmount(row.driverId, amountKey, value)}
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
  return text;
}

export function HrPayrollGrid(props: {
  columns: readonly HrColumn[];
  rows: readonly HrPayrollRow[];
  sourceRows: readonly HrPayrollRow[];
  filters: Readonly<Record<string, string>>;
  onFilter: (key: string, value: string) => void;
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
  all: string;
  onSelect: (driverId: string, key: keyof HrEditState, value: number) => void;
  onAmount: (driverId: string, key: keyof HrEditState, value: number) => void;
}): JSX.Element {
  const [sort, setSort] = useState<HrSort | null>(null);
  const offsets = stickyOffsets(props.columns);
  const ordered = [...props.rows].sort((a, b) => {
    if (props.groupBy !== "none") {
      const group = groupRank(a, props.groupBy).localeCompare(groupRank(b, props.groupBy));
      if (group !== 0) return group;
    }
    if (!sort) return 0;
    return compareSorted(a, b, sort.key, sort.mode);
  });
  const totals = hrFooterTotals(props.rows);
  const nameIndex = props.columns.findIndex((column) => column.key === "name");
  const riderLabelAt = nameIndex >= 0 ? nameIndex : 0;
  const body: JSX.Element[] = [];
  if (ordered.length === 0) {
    body.push(
      <tr key="empty">
        <td colSpan={props.columns.length}>{props.empty}</td>
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
              <td colSpan={props.columns.length}>{shown}</td>
            </tr>,
          );
          previous = value;
        }
      }
      dataIndex += 1;
      const index = dataIndex;
      body.push(
        <tr key={row.driverId} className={props.flash.has(row.driverId) ? "hrpay-flash" : undefined}>
          {props.columns.map((column, columnIndex) => {
            const paint = column.key === "name" ? hrStatusPaint(row.statusKey, row.jobEndDescription) : null;
            const sticky = stickyBox(columnIndex, offsets, column.width);
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
                props.canManage,
                props.awaiting,
                props.noRate,
                props.onSelect,
                props.onAmount,
              )}
            </td>
            );
          })}
        </tr>,
      );
    }
  }
  let bandStart = 0;
  const bands = hrGroupSpans(props.columns).map((span) => {
    const start = bandStart;
    bandStart += span.count;
    const sticky = start < 4;
    const edge = sticky && start + span.count >= 4;
    const bandClass = edge ? "hrpay-band hrpay-sticky hrpay-edge" : sticky ? "hrpay-band hrpay-sticky" : "hrpay-band";
    return (
      <th
        key={`${span.group}-${start}`}
        className={bandClass}
        colSpan={span.count}
        style={
          sticky
            ? { background: HR_GROUP_FILL[span.group], insetInlineStart: offsets[start] ?? 0 }
            : { background: HR_GROUP_FILL[span.group] }
        }
      >
        {props.groupLabels[span.group]}
      </th>
    );
  });
  return (
    <div className="hrpay-scroll">
      <table className="hrpay-table">
        <thead>
          <tr>{bands}</tr>
          <tr>
            {props.columns.map((column, index) => (
              <th
                key={column.key}
                className={withSticky("hrpay-colhead", index)}
                style={stickyBox(index, offsets, column.width)}
              >
                <button type="button" className="hrpay-sort" onClick={() => setSort((current) => nextSort(column, current))}>
                  {props.headers[column.key] ?? column.header}
                  {sort?.key === column.key ? sortMark(sort.mode) : ""}
                </button>
              </th>
            ))}
          </tr>
          <tr>
            {props.columns.map((column, index) => (
              <th
                key={column.key}
                className={withSticky("hrpay-filter", index)}
                style={stickyBox(index, offsets, column.width)}
              >
                {hrFilterControl(column, props.sourceRows, props.filters, props.all, props.awaiting, props.onFilter)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        <tfoot>
          <tr className="hrpay-foot">
            {props.columns.map((column, index) => {
              const summed = footerMoney(column.key, totals);
              const text = index === riderLabelAt ? props.totalRiders : summed ?? "";
              return (
                <td key={column.key} className={stickyOnly(index)} style={stickyBox(index, offsets, column.width)}>
                  {text}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
