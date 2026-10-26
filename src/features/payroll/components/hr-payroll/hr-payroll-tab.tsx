"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  filterHrSheet,
  hrColumnFilterMode,
  hrKpis,
  summarizeHr,
} from "../../hr-payroll-formulas";
import { parseHrImport } from "../../hr-payroll-import";
import { HR_STATUS_ORDER, hrStatusPaint, type HrStatusKey } from "../../hr-payroll-status";
import type { HrRateEvent, HrRateLine } from "../../hr-rate";
import { listHrRateCatalog, saveHrRateLines } from "../../hr-rate-actions";
import type {
  HrBundle,
  HrCellPatch,
  HrColumnFilter,
  HrEditState,
  HrGroupBy,
  HrImportField,
  HrPayrollGroup,
  HrSheetFilters,
  HrSummaryBy,
  HrSummaryLine,
} from "../../hr-payroll-types";
import { EMPTY_HR_SHEET_FILTERS } from "../../hr-payroll-types";
import { fetchHrPayrollBundle, saveHrPayrollCells } from "../../payroll-actions";
import type { PayrollRiderRow } from "../../payroll-types";
import { HrColumnsDialog, HrImportDialog } from "./hr-payroll-dialogs";
import { HrPayrollConfig } from "./hr-payroll-config";
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

type HrView = "payroll" | "summary" | "config";

function readGroupBy(value: string): HrGroupBy | null {
  switch (value) {
    case "none":
    case "company":
    case "project":
    case "section":
    case "clientName":
    case "zone":
    case "vehicle":
    case "sponsor":
    case "rest":
    case "status":
    case "natCat":
    case "hiring":
      return value;
    default:
      return null;
  }
}

function uniqueValues(rows: readonly { cells: Record<string, string>; project: string; zone: string; company: string }[], pick: "project" | "zone" | "company" | "vtype" | "nationality" | "rest", skip: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (pick === "project" || pick === "zone" || pick === "company" ? row[pick] : row.cells[pick] ?? "").trim();
    if (!value || skip.has(value)) continue;
    seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function historyField(field: HrRateEvent["field"], t: (key: "config.rateChanged" | "config.rateAdded" | "config.rateRemoved") => string): string {
  switch (field) {
    case "Rate":
      return t("config.rateChanged");
    case "Rate added":
      return t("config.rateAdded");
    case "Rate removed":
      return t("config.rateRemoved");
    default: {
      const unreachable: never = field;
      return unreachable;
    }
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
  const queryClient = useQueryClient();
  const bundleQuery = useQuery({
    queryKey: queryKeys.payroll.hrPayroll(monthKey, locale),
    queryFn: () => fetchHrPayrollBundle(monthKey, locale),
  });
  const ratesQuery = useQuery({
    queryKey: queryKeys.payroll.hrRates(),
    queryFn: () => listHrRateCatalog(),
  });
  const saveRates = useMutation({
    mutationFn: (lines: readonly HrRateLine[]) => saveHrRateLines([...lines]),
    onSuccess: (result) => {
      if (result.error) {
        toast.error(t("config.saveFailed"));
        return;
      }
      toast.success(t("config.saved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.hrRates() });
    },
  });
  const bundle: HrBundle | null = bundleQuery.data ?? null;
  const rateLines = ratesQuery.data?.lines ?? [];
  const [view, setView] = useState<HrView>("payroll");
  const [sheetFilters, setSheetFilters] = useState<HrSheetFilters>(EMPTY_HR_SHEET_FILTERS);
  const [search, setSearch] = useState("");
  const [statusKey, setStatusKey] = useState("");
  const [sheetView, setSheetView] = useState<"table" | "cards">("table");
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
      rate: t("cols.rate"),
      vtype: t("cols.vtype"),
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
      cfg: t("groups.cfg"),
      ops: t("groups.ops"),
      in: t("groups.in"),
      calc: t("groups.calc"),
      imp: t("groups.imp"),
      pay: t("groups.pay"),
    }),
    [t],
  );

  const rows = useMemo(
    () => buildHrPayrollRows({ riders, bundle, monthDays, edits, statusLabels, rates: rateLines, noRateLabel: t("noRate") }),
    [riders, bundle, monthDays, edits, statusLabels, rateLines, t],
  );
  const missingRates = useMemo(() => {
    if (rows.length === 0) return null;
    const noRate = t("noRate");
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.cells.rate !== noRate) continue;
      const label = `${row.project || "—"} · ${row.zone || "—"}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count }));
  }, [rows, t]);
  const searched = useMemo(
    () => filterHrRows(rows, { search, statusKey, filters: [] }),
    [rows, search, statusKey],
  );
  const sheeted = useMemo(() => filterHrSheet(searched, sheetFilters), [searched, sheetFilters]);
  const visible: readonly HrColumn[] = useMemo(() => visibleHrColumns(shown), [shown]);
  const columnFilters = useMemo(() => {
    const filters: HrColumnFilter[] = [];
    for (const column of visible) {
      const mode = hrColumnFilterMode(column.key, sheeted);
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
  }, [visible, sheeted, colFilters]);
  const filtered = useMemo(
    () => filterHrRows(sheeted, { search: "", statusKey: "", filters: columnFilters }),
    [sheeted, columnFilters],
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
        t("summary.vehicleType"),
        t("summary.rate"),
        t("summary.orders"),
        t("summary.payment"),
        t("summary.salary"),
        t("summary.incentive"),
        t("summary.pending"),
        t("summary.sick"),
        t("summary.traffic"),
        t("summary.loan"),
        t("summary.allowances"),
        t("summary.totalDeductions"),
        t("summary.revenue"),
        t("summary.contribution"),
        t("summary.riders"),
      ],
      rows: lines.map((line) => [
        line.label,
        line.vehicleType,
        line.rateLabel,
        String(line.orders),
        money3(line.payment),
        money3(line.salaryAsPerHours),
        money3(line.incentives),
        money3(line.pendingSalary),
        money3(line.sickReimbursement),
        money3(line.trafficViolation),
        money3(line.loanDeduction),
        money3(line.totalAllowances),
        money3(line.totalDeductions),
        money3(line.revenue),
        money3(line.contribution),
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
      case "config":
        void downloadHrWorkbook({
          filename: `hr-payroll-config-${monthKey}.xlsx`,
          headers: [
            t("config.when"),
            t("config.by"),
            t("config.item"),
            t("config.change"),
            t("config.before"),
            t("config.after"),
          ],
          rows: (ratesQuery.data?.history ?? []).map((event) => [
            event.at,
            event.by,
            event.item,
            historyField(event.field, t),
            event.from,
            event.to,
          ]),
        });
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
              sourceRows={sheeted}
              filters={colFilters}
              onFilter={(key, value) => setColFilters((current) => ({ ...current, [key]: value }))}
              groupBy={groupBy}
              canManage={canManage}
              flash={flash}
              headers={headers}
              groupLabels={groupLabels}
              awaiting={t("awaiting")}
              noRate={t("noRate")}
              blank={t("blank")}
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
            monthKey={monthKey}
            monthLabel={monthLabel}
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
              vehicleType: t("summary.vehicleType"),
              rate: t("summary.rate"),
              orders: t("summary.orders"),
              revenue: t("summary.revenue"),
              contribution: t("summary.contribution"),
              grand: t("summary.grand"),
              exportExcel: t("summary.exportExcel"),
            }}
            onByChange={setSummaryBy}
            onExport={(by, lines) => {
              void exportSummary(by, lines);
            }}
          />
        );
      case "config":
        return (
          <HrPayrollConfig
            key={JSON.stringify(rateLines)}
            projects={uniqueValues(rows, "project", new Set(["—", t("noRate")]))}
            zones={uniqueValues(rows, "zone", new Set(["—", t("noRate")]))}
            lines={rateLines}
            history={ratesQuery.data?.history ?? []}
            missing={missingRates}
            canManage={canManage}
            saving={saveRates.isPending}
            labels={{
              title: t("config.title"),
              add: t("config.add"),
              vehicle: t("config.vehicle"),
              project: t("config.project"),
              zone: t("config.zone"),
              rate: t("config.rate"),
              save: t("config.save"),
              invalid: t("config.invalid"),
              empty: t("config.empty"),
              history: t("config.history"),
              search: t("config.search"),
              when: t("config.when"),
              by: t("config.by"),
              item: t("config.item"),
              change: t("config.change"),
              before: t("config.before"),
              after: t("config.after"),
              bike: t("config.bike"),
              car: t("config.car"),
              rateAdded: t("config.rateAdded"),
              rateChanged: t("config.rateChanged"),
              rateRemoved: t("config.rateRemoved"),
              pickProject: t("config.pickProject"),
              pickZone: t("config.pickZone"),
              intro: t("config.intro"),
              lineCount: t("config.lineCount"),
              saveOne: t("config.saveOne"),
              saveMany: t("config.saveMany"),
              rateKwd: t("config.rateKwd"),
              remove: t("config.remove"),
              chooseZone: t("config.chooseZone"),
              none: t("config.none"),
              current: t("config.current"),
              historySub: t("config.historySub"),
              searchPlaceholder: t("config.searchPlaceholder"),
              noRateStrong: t("config.noRateStrong"),
              noRateAdd: t("config.noRateAdd"),
              allRated: t("config.allRated"),
            }}
            onSave={(lines) => saveRates.mutate(lines)}
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
          <h1 className="hrpay-title">{t("title")}</h1>
          <p className="hrpay-sub">{t("subtitle")}</p>
        </div>
        <div className="hrpay-actions">
          <button
            type="button"
            className="hrpay-btn"
            onClick={() => {
              setSearch("");
              setStatusKey("");
              setColFilters({});
              setSheetFilters(EMPTY_HR_SHEET_FILTERS);
            }}
          >
            {t("clear")}
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
        <button
          type="button"
          className="hrpay-tab"
          data-active={view === "config" ? "true" : "false"}
          onClick={() => setView("config")}
        >
          {t("viewConfig")}
        </button>
      </div>
      {view === "payroll" ? (
        <div className="hrpay-stage">
          <div className="hrpay-fbar">
            <label>
              {t("sheetClient")}
              <select
                className="hrpay-select"
                data-on={sheetFilters.clientName ? "true" : "false"}
                value={sheetFilters.clientName}
                onChange={(event) => setSheetFilters((current) => ({ ...current, clientName: event.target.value }))}
              >
                <option value="">{t("all")}</option>
                {uniqueValues(rows, "project", new Set(["—", t("noRate")])).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t("sheetZone")}
              <select
                className="hrpay-select"
                data-on={sheetFilters.zone ? "true" : "false"}
                value={sheetFilters.zone}
                onChange={(event) => setSheetFilters((current) => ({ ...current, zone: event.target.value }))}
              >
                <option value="">{t("all")}</option>
                {uniqueValues(rows, "zone", new Set(["—", t("noRate")])).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t("sheetVehicle")}
              <select
                className="hrpay-select"
                data-on={sheetFilters.vehicle ? "true" : "false"}
                value={sheetFilters.vehicle}
                onChange={(event) => setSheetFilters((current) => ({ ...current, vehicle: event.target.value }))}
              >
                <option value="">{t("all")}</option>
                {uniqueValues(rows, "vtype", new Set(["—", t("noRate")])).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t("sheetNationality")}
              <select
                className="hrpay-select"
                data-on={sheetFilters.nationality ? "true" : "false"}
                value={sheetFilters.nationality}
                onChange={(event) => setSheetFilters((current) => ({ ...current, nationality: event.target.value }))}
              >
                <option value="">{t("all")}</option>
                {uniqueValues(rows, "nationality", new Set(["—", t("noRate")])).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t("sheetCompany")}
              <select
                className="hrpay-select"
                data-on={sheetFilters.company ? "true" : "false"}
                value={sheetFilters.company}
                onChange={(event) => setSheetFilters((current) => ({ ...current, company: event.target.value }))}
              >
                <option value="">{t("all")}</option>
                {uniqueValues(rows, "company", new Set(["—", t("noRate")])).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t("sheetStore")}
              <select
                className="hrpay-select"
                data-on={sheetFilters.store ? "true" : "false"}
                value={sheetFilters.store}
                onChange={(event) => setSheetFilters((current) => ({ ...current, store: event.target.value }))}
              >
                <option value="">{t("all")}</option>
                {uniqueValues(rows, "rest", new Set(["—", t("noRate")])).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
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
          <div className="hrpay-kpis">
            <div className="hrpay-kpi hrpay-kpi-lead">
              <div className="hrpay-kpi-label">{t("kpiRiders")}</div>
              <div className="hrpay-kpi-value">{monthKpis.riders}</div>
            </div>
            <div className="hrpay-kpi hrpay-kpi-lead">
              <div className="hrpay-kpi-label">{t("kpiActive")}</div>
              <div className="hrpay-kpi-value">{monthKpis.active}</div>
            </div>
            <div className="hrpay-kpi">
              <div className="hrpay-kpi-label">{t("kpiPayment")}</div>
              <div className="hrpay-kpi-value">{moneyGrouped(monthKpis.payment)}</div>
            </div>
          </div>
          <div>
            <div className="hrpay-stiles-head">
              <h2>{t("statusHeading")}</h2>
              <span className="hrpay-sub">{t("statusHint")}</span>
            </div>
            <div className="hrpay-stiles">
              {HR_STATUS_ORDER.map((key) => {
                const paint = hrStatusPaint(key, "", true);
                return (
                  <button key={key} type="button" className="hrpay-st" data-on={statusKey === key ? "true" : "false"} onClick={() => setStatusKey((current) => (current === key ? "" : key))}>
                    <i className="hrpay-st-swatch" data-split={paint.split ? "true" : undefined} data-bordered={paint.bordered ? "true" : undefined} style={paint.split || paint.bordered ? undefined : { background: paint.fill }} />
                    <span><b>{statusCounts.get(key) ?? 0}</b>{statusLabels[key]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="hrpay-sheet">
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
                <option value="clientName">{t("groupClient")}</option>
                <option value="zone">{t("groupZone")}</option>
                <option value="vehicle">{t("groupVehicle")}</option>
                <option value="sponsor">{t("groupSponsor")}</option>
                <option value="rest">{t("groupStore")}</option>
                <option value="status">{t("groupStatus")}</option>
                <option value="natCat">{t("groupNationality")}</option>
                <option value="hiring">{t("groupHiring")}</option>
              </select>
              <div className="hrpay-vt">
                <button type="button" data-on={sheetView === "table" ? "true" : "false"} onClick={() => setSheetView("table")}>{t("viewTable")}</button>
                <button type="button" data-on={sheetView === "cards" ? "true" : "false"} onClick={() => setSheetView("cards")}>{t("viewCards")}</button>
              </div>
              <button
                type="button"
                className="hrpay-btn hrpay-btn-import"
                disabled={!canManage}
                onClick={() => setImportOpen(true)}
              >
                {t("import")}
              </button>
              <button type="button" className="hrpay-btn" onClick={() => setColumnsOpen(true)}>
                {t("columns")}
                <span className="hrpay-chip">{t("columnsCount", { count: shown.size })}</span>
              </button>
            </div>
            <div className="hrpay-source">
              <span><i style={{ background: "#EDEEF6" }} />{t("sourceEmp")}</span>
              <span><i style={{ background: "#E4F1F2" }} />{t("sourceCfg")}</span>
              <span><i style={{ background: "#F8ECE6" }} />{t("sourceOps")}</span>
              <span><i style={{ background: "#FBF4E2" }} />{t("sourceIn")}</span>
              <span><i style={{ background: "#EAF3EF" }} />{t("sourceCalc")}</span>
              <span><i style={{ background: "#EEF0F8" }} />{t("sourceImp")}</span>
              <span><i style={{ background: "#E8E9F2" }} />{t("sourcePay")}</span>
            </div>
            {sheetView === "table" ? renderBody() : filtered.length === 0 ? (
              <p className="hrpay-sub">{t("empty")}</p>
            ) : (
              <div className="hrpay-cards">
                {filtered.map((row) => {
                  const paint = hrStatusPaint(row.statusKey, row.jobEndDescription);
                  return (
                    <article key={row.driverId} className="hrpay-card">
                      <strong style={paint.split || paint.bordered ? undefined : { background: paint.fill, color: paint.text }}>{row.cells.name || t("blank")}</strong>
                      <div className="hrpay-sub">{row.cells.mg || "—"}</div>
                      <div className="hrpay-sub">{row.cells.clientName || "—"} · {row.zone || "—"}</div>
                      <div>{moneyGrouped(row.numbers.payment)}</div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : renderBody()}
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
          <span>{t("rules.revenue")}</span>
          <span className="hrpay-formula">{t("rules.revenueFormula")}</span>
          <span>{t("rules.contribution")}</span>
          <span className="hrpay-formula">{t("rules.contributionFormula")}</span>
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
