"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type JSX } from "react";
import { useTranslations } from "next-intl";
import { summarizeHr } from "../../hr-payroll-formulas";
import type { HrPayrollRow, HrSummaryBy, HrSummaryLine } from "../../hr-payroll-types";
import { moneyGrouped } from "./hr-payroll-ui";
import { useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { ListToolbar, rowMatches, visibleColumnIds } from "@/features/roster/table-kit";

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
  vehicleType: string;
  rate: string;
  orders: string;
  revenue: string;
  contribution: string;
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
    case "vehicleType":
      return line.vehicleType;
    case "rateLabel":
      return line.rateLabel;
    case "riders":
      return String(line.riders);
    case "orders":
      return String(line.orders);
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
    case "revenue":
      return moneyGrouped(line.revenue);
    case "contribution":
      return moneyGrouped(line.contribution);
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function cellMuted(line: HrSummaryLine, key: SortKey): boolean {
  switch (key) {
    case "label":
    case "vehicleType":
    case "rateLabel":
      return false;
    case "riders":
      return line.riders === 0;
    case "orders":
      return line.orders === 0;
    case "payment":
      return line.payment === 0;
    case "salaryAsPerHours":
      return line.salaryAsPerHours === 0;
    case "incentives":
      return line.incentives === 0;
    case "pendingSalary":
      return line.pendingSalary === 0;
    case "sickReimbursement":
      return line.sickReimbursement === 0;
    case "trafficViolation":
      return line.trafficViolation === 0;
    case "loanDeduction":
      return line.loanDeduction === 0;
    case "totalAllowances":
      return line.totalAllowances === 0;
    case "totalDeductions":
      return line.totalDeductions === 0;
    case "revenue":
      return line.revenue === 0;
    case "contribution":
      return line.contribution === 0;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function compareLines(a: HrSummaryLine, b: HrSummaryLine, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "label":
      return a.label.localeCompare(b.label) * sign;
    case "vehicleType":
      return a.vehicleType.localeCompare(b.vehicleType) * sign;
    case "rateLabel":
      return a.rateLabel.localeCompare(b.rateLabel, undefined, { numeric: true }) * sign;
    case "riders":
      return (a.riders - b.riders) * sign;
    case "orders":
      return (a.orders - b.orders) * sign;
    case "payment":
      return (a.payment - b.payment) * sign;
    case "salaryAsPerHours":
      return (a.salaryAsPerHours - b.salaryAsPerHours) * sign;
    case "incentives":
      return (a.incentives - b.incentives) * sign;
    case "pendingSalary":
      return (a.pendingSalary - b.pendingSalary) * sign;
    case "sickReimbursement":
      return (a.sickReimbursement - b.sickReimbursement) * sign;
    case "trafficViolation":
      return (a.trafficViolation - b.trafficViolation) * sign;
    case "loanDeduction":
      return (a.loanDeduction - b.loanDeduction) * sign;
    case "totalAllowances":
      return (a.totalAllowances - b.totalAllowances) * sign;
    case "totalDeductions":
      return (a.totalDeductions - b.totalDeductions) * sign;
    case "revenue":
      return (a.revenue - b.revenue) * sign;
    case "contribution":
      return (a.contribution - b.contribution) * sign;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function lineNumber(line: HrSummaryLine, key: Exclude<SortKey, "label" | "vehicleType" | "rateLabel" | "key">): number {
  switch (key) {
    case "riders":
      return line.riders;
    case "orders":
      return line.orders;
    case "payment":
      return line.payment;
    case "salaryAsPerHours":
      return line.salaryAsPerHours;
    case "incentives":
      return line.incentives;
    case "pendingSalary":
      return line.pendingSalary;
    case "sickReimbursement":
      return line.sickReimbursement;
    case "trafficViolation":
      return line.trafficViolation;
    case "loanDeduction":
      return line.loanDeduction;
    case "totalAllowances":
      return line.totalAllowances;
    case "totalDeductions":
      return line.totalDeductions;
    case "revenue":
      return line.revenue;
    case "contribution":
      return line.contribution;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function totalOf(lines: readonly HrSummaryLine[], key: Exclude<SortKey, "label" | "vehicleType" | "rateLabel" | "key">): number {
  let sum = 0;
  for (const line of lines) sum += lineNumber(line, key);
  return sum;
}

function footerText(lines: readonly HrSummaryLine[], key: SortKey): string {
  switch (key) {
    case "label":
    case "vehicleType":
    case "rateLabel":
      return "";
    case "riders":
    case "orders":
      return String(totalOf(lines, key));
    case "payment":
    case "salaryAsPerHours":
    case "incentives":
    case "pendingSalary":
    case "sickReimbursement":
    case "trafficViolation":
    case "loanDeduction":
    case "totalAllowances":
    case "totalDeductions":
    case "revenue":
    case "contribution":
      return moneyGrouped(totalOf(lines, key));
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function monthName(copy: (key: "m1" | "m2" | "m3" | "m4" | "m5" | "m6" | "m7" | "m8" | "m9" | "m10" | "m11" | "m12") => string, month: number): string {
  switch (month) {
    case 1:
      return copy("m1");
    case 2:
      return copy("m2");
    case 3:
      return copy("m3");
    case 4:
      return copy("m4");
    case 5:
      return copy("m5");
    case 6:
      return copy("m6");
    case 7:
      return copy("m7");
    case 8:
      return copy("m8");
    case 9:
      return copy("m9");
    case 10:
      return copy("m10");
    case 11:
      return copy("m11");
    case 12:
      return copy("m12");
    default:
      return String(month);
  }
}

export function HrPayrollSummary(props: {
  rows: readonly HrPayrollRow[];
  labels: HrPayrollSummaryLabels;
  monthKey: string;
  monthLabel: string;
  onByChange?: (by: HrSummaryBy) => void;
  onExport: (by: HrSummaryBy, lines: readonly HrSummaryLine[]) => void;
}): JSX.Element {
  const { rows, labels, onExport } = props;
  const copy = useTranslations("pages.payroll.hr.summary");
  const loadedYear = Number(props.monthKey.slice(0, 4));
  const loadedMonth = Number(props.monthKey.slice(5, 7));
  const [months, setMonths] = useState<number[]>(() => (Number.isFinite(loadedMonth) ? [loadedMonth] : []));
  const [years, setYears] = useState<number[]>(() => (Number.isFinite(loadedYear) ? [loadedYear] : []));
  useEffect(() => {
    setMonths(Number.isFinite(loadedMonth) ? [loadedMonth] : []);
    setYears(Number.isFinite(loadedYear) ? [loadedYear] : []);
  }, [loadedMonth, loadedYear]);
  const [by, setBy] = useState<HrSummaryBy>("company");
  const [sortKey, setSortKey] = useState<SortKey>("payment");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [project, setProject] = useState("");
  const projects = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      const value = row.project.trim();
      if (value && value !== "—") seen.add(value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const scoped = useMemo(() => (project ? rows.filter((row) => row.project === project) : rows), [rows, project]);
  const lines = useMemo(() => summarizeHr(scoped, by), [scoped, by]);
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
    for (const row of scoped) {
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
      revenue: scoped.reduce((sum, row) => sum + row.numbers.revenue, 0),
      contribution: scoped.reduce((sum, row) => sum + row.numbers.contribution, 0),
    };
  }, [scoped]);
  const salaryPct = kpis.payment === 0 ? "0.0" : ((kpis.salary / kpis.payment) * 100).toFixed(1);
  const columns: readonly { key: SortKey; title: string }[] = [
    { key: "label", title: groupLabel(by, labels) },
    { key: "vehicleType", title: labels.vehicleType },
    { key: "rateLabel", title: labels.rate },
    { key: "orders", title: labels.orders },
    { key: "payment", title: labels.payment },
    { key: "salaryAsPerHours", title: labels.salary },
    { key: "incentives", title: labels.incentive },
    { key: "pendingSalary", title: labels.pending },
    { key: "sickReimbursement", title: labels.sick },
    { key: "trafficViolation", title: labels.traffic },
    { key: "loanDeduction", title: labels.loan },
    { key: "totalAllowances", title: labels.allowances },
    { key: "totalDeductions", title: labels.totalDeductions },
    { key: "revenue", title: labels.revenue },
    { key: "contribution", title: labels.contribution },
    { key: "riders", title: labels.riders },
  ];
  const columnSignature = columns.map((column) => `${column.key}:${column.title}`).join("|");
  const summaryColumns = useMemo<TableToolbarColumn[]>(
    () => columns.map((column) => ({ id: column.key, label: column.title, locked: column.key === "label" })),
    [columnSignature],
  );
  const summaryPrefs = useTablePrefs("payroll.hrSummary", summaryColumns);
  const shownLines = sortedLines.filter((line) =>
    rowMatches(summaryPrefs.appliedQuery, [cellText(line, "label"), cellText(line, "vehicleType"), cellText(line, "rateLabel")]),
  );
  const shownIds = visibleColumnIds(summaryPrefs);
  const shownColumns = shownIds
    .map((id) => columns.find((column) => column.key === id))
    .filter((column): column is { key: SortKey; title: string } => column != null);
  const chartOn = months.includes(loadedMonth) && years.includes(loadedYear);
  const chart = chartOn
    ? { label: props.monthLabel, revenue: kpis.revenue, payment: kpis.payment, contribution: kpis.contribution }
    : null;
  const maxBar = Math.max(chart?.revenue ?? 0, chart?.payment ?? 0, Math.abs(chart?.contribution ?? 0), 1);
  const yearChoices = [loadedYear - 1, loadedYear].filter((year) => Number.isFinite(year));

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
      <div className="hrpay-sumtop">
        <details className="hrpay-multi">
          <summary>{copy("month")}</summary>
          <div>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => (
              <label key={month}>
                <input
                  type="checkbox"
                  checked={months.includes(month)}
                  onChange={() =>
                    setMonths((current) =>
                      current.includes(month) ? current.filter((value) => value !== month) : [...current, month],
                    )
                  }
                />
                {monthName(copy, month)}
              </label>
            ))}
          </div>
        </details>
        <details className="hrpay-multi">
          <summary>{copy("year")}</summary>
          <div>
            {yearChoices.map((year) => (
              <label key={year}>
                <input
                  type="checkbox"
                  checked={years.includes(year)}
                  onChange={() =>
                    setYears((current) =>
                      current.includes(year) ? current.filter((value) => value !== year) : [...current, year],
                    )
                  }
                />
                {year}
              </label>
            ))}
          </div>
        </details>
        <label>
          {copy("project")}
          <select className="hrpay-select" value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">{copy("allProjects")}</option>
            {projects.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.byLabel}
          <select className="hrpay-select" value={by} onChange={onByChange}>
            {SUMMARY_BY.map((option) => (
              <option key={option} value={option}>
                {groupLabel(option, labels)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hrpay-sub">{chart ? props.monthLabel : copy("noChart")}</p>
      <div className="hrpay-kpis hrpay-kpis-wrap">
        <div className="hrpay-kpi hrpay-kpi-hero">
          <div className="hrpay-kpi-label">{labels.payment}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.payment)}</div>
          <div className="hrpay-muted">
            {copy("ridersMeta", { riders: scoped.length, groups: lines.length, unit: copy(unitKey(by)) })}
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
        <div className="hrpay-kpi">
          <div className="hrpay-kpi-label">{copy("revenueKpi")}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.revenue)}</div>
        </div>
        <div className="hrpay-kpi">
          <div className="hrpay-kpi-label">{copy("contributionKpi")}</div>
          <div className="hrpay-kpi-value">{moneyGrouped(kpis.contribution)}</div>
        </div>
      </div>
      <div className="hrpay-charts">
        <div className="hrpay-chart">
          <strong>{copy("chartRevenue")}</strong>
          <p className="hrpay-sub">{copy("chartRevenueSub")}</p>
          {chart ? (
            <div className="hrpay-bars">
              <div>
                <span style={{ height: `${(chart.revenue / maxBar) * 120}px` }} />
                <em>{copy("revenueKpi")}</em>
              </div>
              <div>
                <span className="hrpay-bar-pay" style={{ height: `${(chart.payment / maxBar) * 120}px` }} />
                <em>{labels.payment}</em>
              </div>
            </div>
          ) : (
            <p className="hrpay-muted">{copy("noChart")}</p>
          )}
          <div className="hrpay-chart-legend">
            <span>
              <i style={{ background: "#3F4AA0" }} />
              {copy("legendRevenue")}
            </span>
            <span>
              <i style={{ background: "#C0532B" }} />
              {copy("legendPayment")}
            </span>
          </div>
          {chart ? <div className="hrpay-muted">{chart.label}</div> : null}
        </div>
        <div className="hrpay-chart">
          <strong>{copy("chartContribution")}</strong>
          <p className="hrpay-sub">{copy("chartContributionSub")}</p>
          {chart ? (
            <div className="hrpay-bars">
              <div>
                <span className="hrpay-bar-pay" style={{ height: `${(Math.abs(chart.contribution) / maxBar) * 120}px` }} />
                <em>{copy("contributionKpi")}</em>
              </div>
            </div>
          ) : (
            <p className="hrpay-muted">{copy("noChart")}</p>
          )}
          <div className="hrpay-chart-legend">
            <span>
              <i style={{ background: "#C0532B" }} />
              {copy("chartContribution")}
            </span>
          </div>
        </div>
      </div>
      <div className="hrpay-sheet hrpay-sheet-summary">
      <div className="hrpay-sumbar">
        <strong>{copy("title")}</strong>
        <span className="hrpay-muted">{copy("sortHint")}</span>
      </div>
      <ListToolbar
        prefs={summaryPrefs}
        entity={copy("title")}
        columns={summaryColumns}
        rowKind="aggregate"
        filteredCount={shownLines.length}
        totalCount={sortedLines.length}
        onExport={() => onExport(by, shownLines)}
      />
      <div className="hrpay-scroll">
        <table className="hrpay-table">
          <thead>
            <tr>
              {shownColumns.map((column) => (
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
            {shownLines.map((line) => (
              <tr key={line.key}>
                {shownColumns.map((column) => (
                  <td key={column.key} className={cellMuted(line, column.key) ? "hrpay-muted" : undefined}>
                    {cellText(line, column.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="hrpay-foot">
            <tr>
              {shownColumns.map((column) => {
                if (column.key === "label" || column.key === "vehicleType" || column.key === "rateLabel") {
                  return <td key={column.key}>{column.key === "label" ? labels.grand : ""}</td>;
                }
                const sum = totalOf(shownLines, column.key);
                return (
                  <td key={column.key} className={sum === 0 ? "hrpay-muted" : undefined}>
                    {footerText(shownLines, column.key)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      </div>
    </div>
  );
}
