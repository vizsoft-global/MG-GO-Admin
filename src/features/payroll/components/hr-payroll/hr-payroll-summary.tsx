"use client";

import { useMemo, useState, type ChangeEvent, type CSSProperties, type JSX } from "react";
import { useTranslations } from "next-intl";
import { summarizeHr } from "../../hr-payroll-formulas";
import type { HrPayrollRow, HrSummaryBy, HrSummaryLine } from "../../hr-payroll-types";
import { moneyGrouped } from "./hr-payroll-ui";

type SortKey = Exclude<keyof HrSummaryLine, "key">;
type SortDir = "asc" | "desc";

type HrPayrollSummaryLabels = {
  note: string;
  byLabel: string;
  company: string;
  sponsor: string;
  project: string;
  zone: string;
  section: string;
  payment: string;
  salary: string;
  salaryShare: string;
  extras: string;
  deductionsKpi: string;
  group: string;
  incentive: string;
  pending: string;
  sick: string;
  traffic: string;
  loan: string;
  allowances: string;
  totalDeductions: string;
  riders: string;
  grand: string;
  exportExcel: string;
};

const SUMMARY_BY: readonly HrSummaryBy[] = ["company", "sponsor", "project", "zone", "section"];

const headerButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  margin: 0,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "start",
  cursor: "pointer",
};

function unitKey(
  by: HrSummaryBy,
): "companyUnit" | "sponsorUnit" | "projectUnit" | "zoneUnit" | "sectionUnit" {
  switch (by) {
    case "company":
      return "companyUnit";
    case "sponsor":
      return "sponsorUnit";
    case "project":
      return "projectUnit";
    case "zone":
      return "zoneUnit";
    case "section":
      return "sectionUnit";
    default: {
      const unreachable: never = by;
      return unreachable;
    }
  }
}

function groupLabel(by: HrSummaryBy, labels: HrPayrollSummaryLabels): string {
  switch (by) {
    case "company":
      return labels.company;
    case "sponsor":
      return labels.sponsor;
    case "project":
      return labels.project;
    case "zone":
      return labels.zone;
    case "section":
      return labels.section;
  }
}

function readSummaryBy(value: string): HrSummaryBy | null {
  switch (value) {
    case "company":
    case "sponsor":
    case "project":
    case "zone":
    case "section":
      return value;
    default:
      return null;
  }
}

function cellText(line: HrSummaryLine, key: SortKey): string {
  switch (key) {
    case "label":
      return line.label;
    case "riders":
      return String(line.riders);
    case "payment":
      return moneyGrouped(line.payment);
    case "salaryAsPerHours":
      return moneyGrouped(line.salaryAsPerHours);
    case "incentives":
      return moneyGrouped(line.incentives);
    case "pendingSalary":
      return moneyGrouped(line.pendingSalary);
    case "sickReimbursement":
      return moneyGrouped(line.sickReimbursement);
    case "trafficViolation":
      return moneyGrouped(line.trafficViolation);
    case "loanDeduction":
      return moneyGrouped(line.loanDeduction);
    case "totalAllowances":
      return moneyGrouped(line.totalAllowances);
    case "totalDeductions":
      return moneyGrouped(line.totalDeductions);
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function cellMuted(line: HrSummaryLine, key: SortKey): boolean {
  if (key === "label") return false;
  return line[key] === 0;
}

function compareLines(a: HrSummaryLine, b: HrSummaryLine, key: SortKey, dir: SortDir): number {
  const factor = dir === "asc" ? 1 : -1;
  if (key === "label") return a.label.localeCompare(b.label) * factor;
  return (a[key] - b[key]) * factor;
}

function totalOf(lines: readonly HrSummaryLine[], key: Exclude<SortKey, "label">): number {
  let sum = 0;
  for (const line of lines) sum += line[key];
  return sum;
}

function footerText(lines: readonly HrSummaryLine[], key: Exclude<SortKey, "label">): string {
  const sum = totalOf(lines, key);
  return key === "riders" ? String(sum) : moneyGrouped(sum);
}

export function HrPayrollSummary(props: {
  rows: readonly HrPayrollRow[];
  labels: HrPayrollSummaryLabels;
  onByChange?: (by: HrSummaryBy) => void;
  onExport: (by: HrSummaryBy, lines: readonly HrSummaryLine[]) => void;
}): JSX.Element {
  const { rows, labels, onExport } = props;
  const copy = useTranslations("pages.payroll.hr.summary");
  const [by, setBy] = useState<HrSummaryBy>("company");
  const [sortKey, setSortKey] = useState<SortKey>("payment");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const lines = useMemo(() => summarizeHr(rows, by), [rows, by]);
  const sortedLines = useMemo(() => {
    const copy = [...lines];
    copy.sort((a, b) => compareLines(a, b, sortKey, sortDir));
    return copy;
  }, [lines, sortKey, sortDir]);
  const kpis = useMemo(() => {
    let payment = 0;
    let salary = 0;
    let incentives = 0;
    let allowances = 0;
    let traffic = 0;
    let loan = 0;
    let other = 0;
    for (const row of rows) {
      payment += row.numbers.payment;
      salary += row.numbers.salaryAsPerHours;
      incentives += row.numbers.incentives;
      allowances += row.numbers.totalAllowances;
      traffic += row.numbers.trafficViolation;
      loan += row.numbers.loanDeduction;
      other += row.numbers.totalDeductions;
    }
    return {
      payment,
      salary,
      extras: incentives + allowances,
      deductions: traffic + loan + other,
      incentives,
      allowances,
      traffic,
      loan,
      other,
    };
  }, [rows]);
  const salaryPct = kpis.payment === 0 ? "0.0" : ((kpis.salary / kpis.payment) * 100).toFixed(1);
  const columns: readonly { key: SortKey; title: string }[] = [
    { key: "label", title: groupLabel(by, labels) },
    { key: "payment", title: labels.payment },
    { key: "salaryAsPerHours", title: labels.salary },
    { key: "incentives", title: labels.incentive },
    { key: "pendingSalary", title: labels.pending },
    { key: "sickReimbursement", title: labels.sick },
    { key: "trafficViolation", title: labels.traffic },
    { key: "loanDeduction", title: labels.loan },
    { key: "totalAllowances", title: labels.allowances },
    { key: "totalDeductions", title: labels.totalDeductions },
    { key: "riders", title: labels.riders },
  ];

  function onByChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = readSummaryBy(event.target.value);
    if (!next) return;
    setBy(next);
    props.onByChange?.(next);
  }

  function onHeader(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  }

  return (
    <div className="hrpay-summary">
      <div className="hrpay-summarise">
        <label>
          {labels.byLabel}
          <select className="hrpay-select" value={by} onChange={onByChange}>
            {SUMMARY_BY.map((option) => (
              <option key={option} value={option}>
                {groupLabel(option, labels)}
              </option>
            ))}
          </select>
          <span className="hrpay-sub">{labels.note}</span>
        </label>
        <button type="button" className="hrpay-btn" onClick={() => onExport(by, sortedLines)}>
          {copy("exportSummary")}
        </button>
      </div>
      <div className="hrpay-kpis">
        <div className="hrpay-kpi hrpay-kpi-hero">
          <div className="hrpay-kpi-label">{labels.payment}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.payment)}</div>
          <div className="hrpay-muted">
            {copy("ridersMeta", { riders: rows.length, groups: lines.length, unit: copy(unitKey(by)) })}
          </div>
        </div>
        <div className="hrpay-kpi">
          <div className="hrpay-kpi-label">{labels.salary}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.salary)}</div>
          <div className="hrpay-muted">{copy("salaryShare", { pct: salaryPct })}</div>
        </div>
        <div className="hrpay-kpi">
          <div className="hrpay-kpi-label">{labels.extras}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.extras)}</div>
          <div className="hrpay-muted">
            {copy("extrasMeta", {
              incentive: moneyGrouped(kpis.incentives),
              allowances: moneyGrouped(kpis.allowances),
            })}
          </div>
        </div>
        <div className="hrpay-kpi">
          <div className="hrpay-kpi-label">{labels.deductionsKpi}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.deductions)}</div>
          <div className="hrpay-muted">
            {copy("deductionsMeta", {
              traffic: moneyGrouped(kpis.traffic),
              loan: moneyGrouped(kpis.loan),
              other: moneyGrouped(kpis.other),
            })}
          </div>
        </div>
      </div>
      <div className="hrpay-sumbar">
        <strong>{copy("title")}</strong>
        <span className="hrpay-muted">{copy("sortHint")}</span>
      </div>
      <div className="hrpay-scroll">
        <table className="hrpay-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="hrpay-sumhead">
                  <button type="button" style={headerButtonStyle} onClick={() => onHeader(column.key)}>
                    {column.title}
                    {sortKey === column.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedLines.map((line) => (
              <tr key={line.key}>
                {columns.map((column) => (
                  <td key={column.key} className={cellMuted(line, column.key) ? "hrpay-muted" : undefined}>
                    {cellText(line, column.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="hrpay-foot">
            <tr>
              {columns.map((column) => {
                if (column.key === "label") return <td key={column.key}>{labels.grand}</td>;
                const sum = totalOf(sortedLines, column.key);
                return (
                  <td key={column.key} className={sum === 0 ? "hrpay-muted" : undefined}>
                    {footerText(sortedLines, column.key)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
