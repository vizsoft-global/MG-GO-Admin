"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query/query-keys";
import {
  HR_COLUMNS,
  HR_GROUP_ORDER,
  visibleHrColumns,
  type HrColumn,
} from "../../hr-payroll-columns";
import { downloadHrWorkbook, hrExportCell } from "../../hr-payroll-export";
import {
  HR_AWAITING,
  buildHrPayrollRows,
  filterHrRows,
  hrColumnFilterMode,
  hrKpis,
  summarizeHr,
} from "../../hr-payroll-formulas";
import { parseHrImport } from "../../hr-payroll-import";
import { HR_STATUS_ORDER, hrStatusPaint, type HrStatusKey } from "../../hr-payroll-status";
import type {
  HrBundle,
  HrCellPatch,
  HrColumnFilter,
  HrEditState,
  HrGroupBy,
  HrImportField,
  HrPayrollGroup,
  HrSummaryBy,
  HrSummaryLine,
} from "../../hr-payroll-types";
import { fetchHrPayrollBundle, saveHrPayrollCells } from "../../payroll-actions";
import type { PayrollRiderRow } from "../../payroll-types";
import { HrColumnsDialog, HrImportDialog } from "./hr-payroll-dialogs";
import { HrPayrollGrid } from "./hr-payroll-grid";
import { HrPayrollSummary } from "./hr-payroll-summary";
import { COLUMN_EDIT, IMPORT_EDIT, money3, moneyGrouped } from "./hr-payroll-ui";
import "./hr-payroll.css";

const EDIT_KEYS = new Set<keyof HrEditState>(Object.values(COLUMN_EDIT));

function editPatch(key: keyof HrEditState, value: number): HrCellPatch {
  switch (key) {
    case "twoYear":
      return { twoYear: value };
    case "fourYear":
      return { fourYear: value };
    case "food":
      return { food: value };
    case "sick":
      return { sick: value };
    case "pending":
      return { pending: value };
    case "traffic":
      return { traffic: value };
    case "loan":
      return { loan: value };
    case "allowances":
      return { allowances: value };
    case "deductions":
      return { deductions: value };
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function readGroupBy(value: string): HrGroupBy | null {
  switch (value) {
    case "none":
    case "company":
    case "project":
    case "section":
      return value;
    default:
      return null;
  }
}


export function HrPayrollTab(props: {
  monthKey: string;
  monthLabel: string;
  monthDays: number;
  riders: readonly PayrollRiderRow[];
  canManage: boolean;
}): JSX.Element {
  const { monthKey, monthLabel, monthDays, riders, canManage } = props;
  const t = useTranslations("pages.payroll.hr");
  const locale = useLocale();
  const bundleQuery = useQuery({
    queryKey: queryKeys.payroll.hrPayroll(monthKey, locale),
    queryFn: () => fetchHrPayrollBundle(monthKey, locale),
  });
  const bundle: HrBundle | null = bundleQuery.data ?? null;
  const [view, setView] = useState<"payroll" | "summary">("payroll");
  const [search, setSearch] = useState("");
  const [statusKey, setStatusKey] = useState("");
  const [groupBy, setGroupBy] = useState<HrGroupBy>("none");
  const [shown, setShown] = useState<Set<HrPayrollGroup>>(() => new Set(HR_GROUP_ORDER));
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, Partial<HrEditState>>>({});
  const [flash, setFlash] = useState<Set<string>>(() => new Set());
  const [summaryBy, setSummaryBy] = useState<HrSummaryBy>("company");
  const [importOpen, setImportOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  const statusLabels = useMemo<Record<HrStatusKey, string>>(
    () => ({
      leave: t("status.leave"),
      leave_return: t("status.leave_return"),
      accident: t("status.accident"),
      absent_mosal: t("status.absent_mosal"),
      absent_moi: t("status.absent_moi"),
      on_hold: t("status.on_hold"),
      new: t("status.new"),
      training: t("status.training"),
      transfer_from_company: t("status.transfer_from_company"),
      cancelled: t("status.cancelled"),
      running: t("status.running"),
      extension: t("status.extension"),
    }),
    [t],
  );
  const headers = useMemo<Record<string, string>>(
    () => ({
      i: t("cols.i"),
      client: t("cols.client"),
      mg: t("cols.mg"),
      name: t("cols.name"),
      civil: t("cols.civil"),
      bankNo: t("cols.bankNo"),
      bank: t("cols.bank"),
      cur: t("cols.cur"),
      payment: t("cols.payment"),
      clientName: t("cols.clientName"),
      zone: t("cols.zone"),
      nationality: t("cols.nationality"),
      natCat: t("cols.natCat"),
      sponsor: t("cols.sponsor"),
      company: t("cols.company"),
      position: t("cols.position"),
      hiring: t("cols.hiring"),
      start: t("cols.start"),
      endDate: t("cols.endDate"),
      endDesc: t("cols.endDesc"),
      status: t("cols.status"),
      section: t("cols.section"),
      rest: t("cols.rest"),
      fixed: t("cols.fixed"),
      wps: t("cols.wps"),
      inc2: t("cols.inc2"),
      inc4: t("cols.inc4"),
      offs: t("cols.offs"),
      fwd: t("cols.fwd"),
      fwh: t("cols.fwh"),
      hourly: t("cols.hourly"),
      orders: t("cols.orders"),
      wd: t("cols.wd"),
      ah: t("cols.ah"),
      restDpd: t("cols.restDpd"),
      riderDpd: t("cols.riderDpd"),
      eff: t("cols.eff"),
      salH: t("cols.salH"),
      inc2v: t("cols.inc2v"),
      inc4v: t("cols.inc4v"),
      incent: t("cols.incent"),
      food: t("cols.food"),
      sick: t("cols.sick"),
      sickR: t("cols.sickR"),
      pending: t("cols.pending"),
      traffic: t("cols.traffic"),
      loan: t("cols.loan"),
      allow: t("cols.allow"),
      ded: t("cols.ded"),
      total: t("cols.total"),
    }),
    [t],
  );
  const groupLabels = useMemo<Record<HrPayrollGroup, string>>(
    () => ({
      emp: t("groups.emp"),
      ops: t("groups.ops"),
      in: t("groups.in"),
      calc: t("groups.calc"),
      imp: t("groups.imp"),
      pay: t("groups.pay"),
    }),
    [t],
  );

  const rows = useMemo(
    () => buildHrPayrollRows({ riders, bundle, monthDays, edits, statusLabels }),
    [riders, bundle, monthDays, edits, statusLabels],
  );
  const searched = useMemo(
    () => filterHrRows(rows, { search, statusKey, filters: [] }),
    [rows, search, statusKey],
  );
  const visible: readonly HrColumn[] = useMemo(() => visibleHrColumns(shown), [shown]);
  const columnFilters = useMemo(() => {
    const filters: HrColumnFilter[] = [];
    for (const column of visible) {
      const mode = hrColumnFilterMode(column.key, searched);
      switch (mode) {
        case "none":
          break;
        case "contains":
        case "exact":
          filters.push({ key: column.key, mode, value: colFilters[column.key] ?? "" });
          break;
        default: {
          const unreachable: never = mode;
          return unreachable;
        }
      }
    }
    return filters;
  }, [visible, searched, colFilters]);
  const filtered = useMemo(
    () => filterHrRows(searched, { search: "", statusKey: "", filters: columnFilters }),
    [searched, columnFilters],
  );
  const monthKpis = hrKpis(rows);
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const key of HR_STATUS_ORDER) counts.set(key, 0);
    for (const row of rows) counts.set(row.statusKey, (counts.get(row.statusKey) ?? 0) + 1);
    return counts;
  }, [rows]);

  function markFlash(ids: readonly string[]) {
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    setFlash(new Set(ids));
    flashTimer.current = window.setTimeout(() => {
      setFlash(new Set());
      flashTimer.current = null;
    }, 1200);
  }

  function toggleGroup(group: HrPayrollGroup) {
    setShown((current) => {
      if (current.has(group) && current.size <= 1) return current;
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  async function saveCell(driverId: string, key: keyof HrEditState, value: number) {
    if (!EDIT_KEYS.has(key)) return;
    const had = Object.prototype.hasOwnProperty.call(edits, driverId);
    const previous = edits[driverId];
    setEdits((current) => ({ ...current, [driverId]: { ...current[driverId], ...editPatch(key, value) } }));
    try {
      await saveHrPayrollCells(monthKey, [{ driverId, patch: editPatch(key, value) }]);
    } catch {
      setEdits((current) => {
        const next = { ...current };
        if (had) next[driverId] = previous ?? {};
        else delete next[driverId];
        return next;
      });
      toast.error(t("saveFailed"));
    }
  }

  async function applyImport(field: HrImportField, text: string) {
    const seen = new Set<string>();
    const roster: { driverId: string; mgId: string; driverCode: string }[] = [];
    for (const row of bundle?.rows ?? []) {
      seen.add(row.driverId);
      roster.push({ driverId: row.driverId, mgId: row.employeeId, driverCode: row.driverCode });
    }
    for (const rider of riders) {
      if (seen.has(rider.driverId)) continue;
      roster.push({ driverId: rider.driverId, mgId: rider.mgId, driverCode: "" });
    }
    const parsed = parseHrImport(text, roster, field);
    const editKey = IMPORT_EDIT[field];
    if (parsed.matched.length > 0) {
      const snapshot = edits;
      setEdits((current) => {
        const next = { ...current };
        for (const match of parsed.matched) {
          next[match.driverId] = { ...current[match.driverId], ...editPatch(editKey, match.amount) };
        }
        return next;
      });
      markFlash(parsed.matched.map((match) => match.driverId));
      try {
        await saveHrPayrollCells(
          monthKey,
          parsed.matched.map((match) => ({
            driverId: match.driverId,
            patch: editPatch(editKey, match.amount),
          })),
        );
      } catch {
        setEdits(snapshot);
        toast.error(t("saveFailed"));
      }
    }
    if (parsed.unknown.length > 0 || parsed.ambiguous.length > 0) {
      const ids = [...parsed.unknown, ...parsed.ambiguous].join(", ");
      toast.error(t("importProblems", { ids }));
    }
  }

  function payrollSheetRows(): string[][] {
    return filtered.map((row, offset) => {
      const index = offset + 1;
      return HR_COLUMNS.map((column) => {
        const raw = column.key === "i" ? String(index) : (row.cells[column.key] ?? "");
        if (raw === HR_AWAITING) return hrExportCell(HR_AWAITING, t("awaiting"));
        return hrExportCell(raw, t("awaiting"));
      });
    });
  }

  async function exportPayroll() {
    await downloadHrWorkbook({
      filename: `hr-payroll-${monthKey}.xlsx`,
      headers: HR_COLUMNS.map((column) => headers[column.key] ?? column.key),
      rows: payrollSheetRows(),
    });
  }

  async function exportSummary(by: HrSummaryBy, lines: readonly HrSummaryLine[]) {
    switch (by) {
      case "company":
      case "sponsor":
      case "project":
      case "zone":
      case "section":
        break;
      default: {
        const unreachable: never = by;
        return unreachable;
      }
    }
    await downloadHrWorkbook({
      filename: `hr-payroll-summary-${monthKey}.xlsx`,
      headers: [
        t("summary.group"),
        t("summary.payment"),
        t("summary.salary"),
        t("summary.incentive"),
        t("summary.pending"),
        t("summary.sick"),
        t("summary.traffic"),
        t("summary.loan"),
        t("summary.allowances"),
        t("summary.totalDeductions"),
        t("summary.riders"),
      ],
      rows: lines.map((line) => [
        line.label,
        money3(line.payment),
        money3(line.salaryAsPerHours),
        money3(line.incentives),
        money3(line.pendingSalary),
        money3(line.sickReimbursement),
        money3(line.trafficViolation),
        money3(line.loanDeduction),
        money3(line.totalAllowances),
        money3(line.totalDeductions),
        String(line.riders),
      ]),
    });
  }

  function exportCurrentView() {
    switch (view) {
      case "payroll":
        void exportPayroll();
        return;
      case "summary":
        void exportSummary(summaryBy, summarizeHr(filtered, summaryBy));
        return;
      default: {
        const unreachable: never = view;
        return unreachable;
      }
    }
  }

  function renderBody(): JSX.Element {
    if (bundleQuery.isPending) return <p className="hrpay-sub">{t("loading")}</p>;
    if (bundleQuery.isError) return <p className="hrpay-sub">{t("loadFailed")}</p>;
    switch (view) {
      case "payroll":
        return (
          <>
            <HrPayrollGrid
              columns={visible}
              rows={filtered}
              sourceRows={searched}
              filters={colFilters}
              onFilter={(key, value) => setColFilters((current) => ({ ...current, [key]: value }))}
              groupBy={groupBy}
              canManage={canManage}
              flash={flash}
              headers={headers}
              groupLabels={groupLabels}
              awaiting={t("awaiting")}
              totalRiders={t("totalRiders", { count: filtered.length })}
              empty={t("empty")}
              all={t("all")}
              onSelect={(driverId, key, value) => {
                void saveCell(driverId, key, value);
              }}
              onAmount={(driverId, key, value) => {
                void saveCell(driverId, key, value);
              }}
            />
          </>
        );
      case "summary":
        return (
          <HrPayrollSummary
            rows={filtered}
            labels={{
              note: t("summary.note"),
              byLabel: t("summary.byLabel"),
              company: t("summary.company"),
              sponsor: t("summary.sponsor"),
              project: t("summary.project"),
              zone: t("summary.zone"),
              section: t("summary.section"),
              payment: t("summary.payment"),
              salary: t("summary.salary"),
              salaryShare: t("summary.salaryShare", { pct: "0.0" }),
              extras: t("summary.extras"),
              deductionsKpi: t("summary.deductions"),
              group: t("summary.group"),
              incentive: t("summary.incentive"),
              pending: t("summary.pending"),
              sick: t("summary.sick"),
              traffic: t("summary.traffic"),
              loan: t("summary.loan"),
              allowances: t("summary.allowances"),
              totalDeductions: t("summary.totalDeductions"),
              riders: t("summary.riders"),
              grand: t("summary.grand"),
              exportExcel: t("summary.exportExcel"),
            }}
            onByChange={setSummaryBy}
            onExport={(by, lines) => {
              void exportSummary(by, lines);
            }}
          />
        );
      default: {
        const unreachable: never = view;
        return unreachable;
      }
    }
  }

  return (
    <div className="hrpay">
      <div className="hrpay-head">
        <div>
          <h1 className="hrpay-title">{monthLabel}</h1>
          <p className="hrpay-sub">{t("subtitle")}</p>
        </div>
        <div className="hrpay-actions">
          {view === "payroll" ? (
            <button type="button" className="hrpay-btn" onClick={() => setColumnsOpen(true)}>
              {t("columns")}
              <span className="hrpay-chip">{t("columnsCount", { count: shown.size })}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="hrpay-btn hrpay-btn-import"
            disabled={!canManage}
            onClick={() => setImportOpen(true)}
          >
            {t("import")}
          </button>
          <button type="button" className="hrpay-btn hrpay-btn-primary" onClick={exportCurrentView}>
            {t("exportExcel")}
          </button>
        </div>
      </div>
      <div className="hrpay-tabs">
        <button
          type="button"
          className="hrpay-tab"
          data-active={view === "payroll" ? "true" : "false"}
          onClick={() => setView("payroll")}
        >
          {t("viewPayroll")}
        </button>
        <button
          type="button"
          className="hrpay-tab"
          data-active={view === "summary" ? "true" : "false"}
          onClick={() => setView("summary")}
        >
          {t("viewSummary")}
        </button>
      </div>
      {view === "payroll" ? (
        <div className="hrpay-tools">
          <input
            className="hrpay-search"
            value={search}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="hrpay-select"
            value={groupBy}
            onChange={(event) => {
              const next = readGroupBy(event.target.value);
              if (next) setGroupBy(next);
            }}
          >
            <option value="none">{t("groupNone")}</option>
            <option value="company">{t("groupCompany")}</option>
            <option value="project">{t("groupProject")}</option>
            <option value="section">{t("groupSection")}</option>
          </select>
          <button
            type="button"
            className="hrpay-btn"
            onClick={() => {
              setSearch("");
              setStatusKey("");
              setColFilters({});
            }}
          >
            {t("clear")}
          </button>
        </div>
      ) : null}
      {view === "payroll" ? (
        <>
          <div className="hrpay-kpis">
            <div className="hrpay-kpi">
              <div className="hrpay-kpi-label">{t("kpiRiders")}</div>
              <div className="hrpay-kpi-value">{monthKpis.riders}</div>
            </div>
            <div className="hrpay-kpi">
              <div className="hrpay-kpi-label">{t("kpiActive")}</div>
              <div className="hrpay-kpi-value">{monthKpis.active}</div>
            </div>
            <div className="hrpay-kpi">
              <div className="hrpay-kpi-label">{t("kpiPayment")}</div>
              <div className="hrpay-kpi-value">{moneyGrouped(monthKpis.payment)}</div>
            </div>
          </div>
          <div className="hrpay-legend">
            {HR_STATUS_ORDER.map((key) => {
              const paint = hrStatusPaint(key, "", true);
              return (
                <button
                  key={key}
                  type="button"
                  className="hrpay-legend-item"
                  data-on={statusKey === key ? "true" : "false"}
                  onClick={() => setStatusKey((current) => (current === key ? "" : key))}
                >
                  <span
                    className="hrpay-dot"
                    data-split={paint.split ? "true" : undefined}
                    data-bordered={paint.bordered ? "true" : undefined}
                    style={paint.split || paint.bordered ? undefined : { background: paint.fill }}
                  />
                  <span>{statusLabels[key]}</span>
                  <span className="hrpay-legend-count">{statusCounts.get(key) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {renderBody()}
      {view === "payroll" ? (
      <details className="hrpay-rules">
        <summary>{t("rulesTitle")}</summary>
        <div className="hrpay-rules-grid">
          <span>{t("rules.fwd")}</span>
          <span className="hrpay-formula">{t("rules.fwdFormula")}</span>
          <span>{t("rules.fwh")}</span>
          <span className="hrpay-formula">{t("rules.fwhFormula")}</span>
          <span>{t("rules.hourly")}</span>
          <span className="hrpay-formula">{t("rules.hourlyFormula")}</span>
          <span>{t("rules.eff")}</span>
          <span className="hrpay-formula">{t("rules.effFormula")}</span>
          <span>{t("rules.salH")}</span>
          <span className="hrpay-formula">{t("rules.salHFormula")}</span>
          <span>{t("rules.inc")}</span>
          <span className="hrpay-formula">{t("rules.incFormula")}</span>
          <span>{t("rules.sick")}</span>
          <span className="hrpay-formula">{t("rules.sickFormula")}</span>
          <span>{t("rules.total")}</span>
          <span className="hrpay-formula">{t("rules.totalFormula")}</span>
          <span>{t("rules.pay")}</span>
          <span className="hrpay-formula">{t("rules.payFormula")}</span>
          <span>{t("rules.ops")}</span>
          <span className="hrpay-formula">{t("rules.opsFormula")}</span>
        </div>
      </details>
      ) : null}
      <HrImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        labels={{
          title: t("importTitle"),
          field: t("importField"),
          pendingSalary: t("importFields.pendingSalary"),
          trafficViolation: t("importFields.trafficViolation"),
          loanDeduction: t("importFields.loanDeduction"),
          totalAllowances: t("importFields.totalAllowances"),
          totalDeductions: t("importFields.totalDeductions"),
          paste: t("importPaste"),
          file: t("importFile"),
          cancel: t("cancel"),
          done: t("done"),
          hint: t("importHint"),
        }}
        onApply={(field, text) => {
          void applyImport(field, text);
        }}
      />
      <HrColumnsDialog
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        shown={shown}
        onToggle={toggleGroup}
        labels={{
          title: t("columnsTitle"),
          done: t("done"),
          ...groupLabels,
        }}
      />
    </div>
  );
}
