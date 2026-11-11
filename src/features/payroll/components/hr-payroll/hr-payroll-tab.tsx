"use client";

import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ColumnOrderMenu } from "@/components/app/column-order-menu";
import { TableFooterExport } from "@/components/app/table-footer-export";
import { formatKwd } from "@/lib/format/money";
import { queryKeys } from "@/lib/query/query-keys";
import { useListColumns } from "@/hooks/use-list-columns";
import { HR_PAYROLL_COLUMNS_PREF_KEY } from "@/lib/ui-preferences/types";
import { identityWidth } from "../../payroll-table-identity";
import { HR_COLUMNS, type HrColumn } from "../../hr-payroll-columns";
import { downloadHrWorkbook, hrExportCell } from "../../hr-payroll-export";
import { payrollColumnLabel } from "../../payroll-column-labels";
import { useRegisterPayrollActions } from "../../payroll-actions-bridge";
import {
  HR_AWAITING,
  buildHrPayrollRows,
  filterHrRows,
  filterHrRowsByColumns,
  filterHrSheet,
  hrKpis,
  hrSalaryShortfall,
  summarizeHr,
} from "../../hr-payroll-formulas";
import { parseHrImport } from "../../hr-payroll-import";
import { HR_STATUS_LEGEND_ORDER, HR_STATUS_ORDER, hrStatusPaint, type HrStatusKey } from "../../hr-payroll-status";
import { columnFilterActive, type ColumnFilters } from "../../payroll-column-filter";
import type { HrRateEvent, HrRateLine } from "../../hr-rate";
import { listHrRateCatalog, saveHrRateLines } from "../../hr-rate-actions";
import { DEFAULT_JOB_POSITIONS } from "@/features/employees/employee-catalogs";
import { listEmployeeCatalog } from "@/features/employees/employee-catalogs-actions";
import { masterFilterValues } from "../../hr-inline-cells";
import { HIRING_TYPES, JOB_END_DESCRIPTIONS } from "@/features/drivers/driver-private-fields";
import type {
  HrBundle,
  HrCellPatch,
  HrEditState,
  HrGroupBy,
  HrImportField,
  HrPayrollGroup,
  HrPayrollRow,
  HrSheetFilters,
  HrSummaryBy,
  HrSummaryLine,
} from "../../hr-payroll-types";
import { EMPTY_HR_SHEET_FILTERS } from "../../hr-payroll-types";
import { usePayrollCellMutation } from "../../use-payroll-cell-mutation";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { subscribePayrollWrites, notifyPayrollWrite } from "../../payroll-sync";
import { fetchHrPayrollBundle, fetchHrAppHours, listHrIdentityOptions, saveHrIdentityCells, saveHrPayrollCells, saveHrVehicleType, type HrIdentityPatch } from "../../payroll-actions";
import { listVehicleTypes } from "@/features/vehicles/vehicles-actions";
import type { PayrollRiderRow } from "../../payroll-types";
import { HrImportDialog } from "./hr-payroll-dialogs";
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

/**
 * One filter list: the values the sheet actually holds, then the rest of the
 * catalog behind it. Defined in `hr-inline-cells.ts` so the test can pin it.
 */


export function HrPayrollTab(props: {
  monthKey: string;
  monthLabel: string;
  monthDays: number;
  riders: readonly PayrollRiderRow[];
  canManage: boolean;
  /** Range presets, rendered above the tab strip at the start edge. */
  rangePills?: ReactNode;
}): JSX.Element {
  const { monthKey, monthLabel, monthDays, riders, canManage, rangePills } = props;
  const t = useTranslations("pages.payroll.hr");
  /**
   * The two compiled enums are labelled where the employee profile already
   * labels them, so the sheet and the profile cannot print different words for
   * the same stored key.
   */
  const tEnum = useTranslations("pages.driverDetail.profile.options");
  /** The Columns menu the shared toolbar renders for this sheet. */
  const tc = useTranslations("pages.payroll.columnsMenu");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const bundleQuery = useQuery({
    queryKey: queryKeys.payroll.hrPayroll(monthKey, locale),
    queryFn: () => fetchHrPayrollBundle(monthKey, locale),
    /**
     * This sheet is money. An order or rate edited on another tab (or in another
     * window) must be visible here without a manual refresh, so the HR bundle
     * never trusts a cached read; the server's read-through snapshot keeps the
     * cost of an aggressive client policy honest.
     */
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const ratesQuery = useQuery({
    queryKey: queryKeys.payroll.hrRates(),
    queryFn: () => listHrRateCatalog(),
  });
  /**
   * Job positions come from the Operations Hub catalog, so a position added there
   * is selectable here without a redeploy.
   */
  const positionsQuery = useQuery({
    queryKey: ["hr-job-positions"],
    queryFn: () => listEmployeeCatalog("job_positions"),
    staleTime: 60_000,
  });
  /** The live vehicle-type catalog. A deleted type still shows on its riders. */
  const vehicleTypesQuery = useQuery({
    queryKey: queryKeys.vehicles.useTypes(),
    queryFn: () => listVehicleTypes(),
    staleTime: 60_000,
  });
  const identityOptionsQuery = useQuery({
    queryKey: ["hr-identity-options"],
    queryFn: () => listHrIdentityOptions(),
    staleTime: 300_000,
  });
  const identityOptions = useMemo(
    () => ({
      banks: (identityOptionsQuery.data?.banks ?? []).map((bank) => ({ value: bank.key, label: bank.label })),
      zones: (identityOptionsQuery.data?.zones ?? []).map((zone) => ({ value: zone.id, label: zone.name })),
      clients: (identityOptionsQuery.data?.clients ?? []).map((client) => ({ value: client.key, label: client.label })),
      /** The employee profile's country master, so the two cannot disagree. */
      nationalities: (identityOptionsQuery.data?.nationalities ?? []).map((country) => ({
        value: country.code,
        label: country.label,
      })),
      /** `nationality_categories`, the catalog Employee Settings edits. */
      nationalityCategories: (identityOptionsQuery.data?.nationalityCategories ?? []).map((category) => ({
        value: category.key,
        label: category.label,
      })),
      /** The live restaurant directory. */
      restaurants: (identityOptionsQuery.data?.restaurants ?? []).map((restaurant) => ({
        value: restaurant.id,
        label: restaurant.name,
      })),
      sponsorships: (identityOptionsQuery.data?.sponsorships ?? []).map((sponsor) => ({
        value: sponsor.key,
        label: sponsor.label,
      })),
      sections: (identityOptionsQuery.data?.sections ?? []).map((section) => ({
        value: section.key,
        label: section.label,
      })),
      /**
       * The compiled six stand in while the catalog read is in flight and when
       * the collection holds none — the same fallback `listHrIdentityOptions`
       * applies, so an unseeded catalog can never leave this picker empty.
       */
      positions:
        (identityOptionsQuery.data?.positions?.length ?? 0) > 0
          ? (identityOptionsQuery.data?.positions ?? []).map((position) => ({
              value: position.key,
              label: position.label,
            }))
          : DEFAULT_JOB_POSITIONS.map((position) => ({
              value: position.key,
              label: position.label_en || position.label_ar || position.key,
            })),
      companies: (identityOptionsQuery.data?.companies ?? []).map((company) => ({
        value: company.key,
        label: company.label,
      })),
      /**
       * These two are compiled on the employee profile (`HIRING_TYPES`,
       * `JOB_END_DESCRIPTIONS`), not catalogs, so the sheet reuses the same
       * labels the profile prints rather than inventing a second vocabulary.
       */
      hiringTypes: HIRING_TYPES.map((value) => ({
        value,
        label: tEnum(`hiringType.${value}`),
      })),
      jobEndDescriptions: JOB_END_DESCRIPTIONS.map((value) => ({
        value,
        label: tEnum(`jobEndDescription.${value}`),
      })),
    }),
    [identityOptionsQuery.data, tEnum],
  );
  /**
   * A catalog edited in Employee Settings must reach this sheet without a page
   * refresh: the poller invalidates the option read, and the sheet re-reads it on
   * the next tick. 60 s is the same cadence the other list pages use.
   */
  useRealtimeInvalidator({
    channel: "admin-hr-payroll-catalogs",
    tables: [
      { table: "nationality_categories" },
      { table: "restaurants" },
      { table: "bank_codes" },
      { table: "zones" },
      { table: "payroll_clients" },
    ],
    invalidateKeys: [["hr-identity-options"]],
  });
  /**
   * App-open hours (Shift in → Shift out) for every rider in the month. Display
   * only — it fills one column and enters no pay formula.
   */
  const appHoursQuery = useQuery({
    queryKey: [...queryKeys.payroll.hrPayroll(monthKey, locale), "app-hours"],
    queryFn: () => fetchHrAppHours(monthKey),
    staleTime: 60_000,
  });
  const vehicleOptions = useMemo(
    () =>
      (vehicleTypesQuery.data ?? [])
        .filter((row) => row.is_active)
        .map((row) => ({
          key: row.key,
          label: locale === "ar" ? row.label_ar || row.label_en : row.label_en || row.key,
        })),
    [vehicleTypesQuery.data, locale],
  );
  const positionOptions = useMemo(
    () =>
      (positionsQuery.data ?? [])
        .filter((row) => row.is_active)
        .map((row) => ({
          key: row.key,
          label: locale === "ar" ? row.label_ar || row.label_en : row.label_en || row.key,
        })),
    [positionsQuery.data, locale],
  );
  const saveRates = useMutation({
    mutationFn: (lines: readonly HrRateLine[]) => saveHrRateLines([...lines]),
    onSuccess: (result) => {
      if (result.error) {
        toast.error(t("config.saveFailed"));
        return;
      }
      toast.success(t("config.savedAndPriced"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.hrRates() });
      // The formula runs on this screen, so "recalculate" means "refetch the
      // bundle": Rate, Revenue, Salary as per Hours, Total Salary, Payment, the
      // summary and the cards all re-derive from the new lines.
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    },
  });
  const bundle: HrBundle | null = bundleQuery.data ?? null;
  const rateLines = ratesQuery.data?.lines ?? [];
  const [view, setView] = useState<HrView>("payroll");
  const [sheetFilters, setSheetFilters] = useState<HrSheetFilters>(EMPTY_HR_SHEET_FILTERS);
  const [search, setSearch] = useState("");
  const [statusKey, setStatusKey] = useState("");
  /** `Total active riders` card pressed: the sheet shows only active riders. */
  const [activeOnly, setActiveOnly] = useState(false);
  const [sheetView, setSheetView] = useState<"table" | "cards">("table");
  const [groupBy, setGroupBy] = useState<HrGroupBy>("none");
  /**
   * Column order and visibility for the sheet, saved per staff member. The four
   * frozen identity columns are not in the catalogue: their sticky offsets are
   * applied by position, so they cannot be moved or hidden.
   */
  const hrColumnIds = useMemo(
    () => HR_COLUMNS.filter((column) => identityWidth(column.key) === 0).map((column) => column.key),
    [],
  );
  const columns = useListColumns(HR_PAYROLL_COLUMNS_PREF_KEY, hrColumnIds);
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [edits, setEdits] = useState<Record<string, Partial<HrEditState>>>({});
  const [flash, setFlash] = useState<Set<string>>(() => new Set());
  const [summaryBy, setSummaryBy] = useState<HrSummaryBy>("company");
  const [importOpen, setImportOpen] = useState(false);
  const flashTimer = useRef<number | null>(null);
  /** Rows as the grid paints them (filtered, grouped, sorted) — the export source. */
  const orderedRef = useRef<readonly HrPayrollRow[]>([]);
  /** Latest edits, readable from the optimistic patch without a stale closure. */
  const editsRef = useRef<Record<string, Partial<HrEditState>>>({});
  editsRef.current = edits;

  /**
   * The one cell-write path: optimistic patch → callable → invalidate + notify
   * the other tab, with the patch rolled back and the reason kept on the cell
   * when the server refuses it.
   */
  const cellWrite = usePayrollCellMutation<
    { driverId: string; key: keyof HrEditState; value: number },
    { saved: number; skipped: number }
  >({
    mutationFn: ({ driverId, key, value }) =>
      saveHrPayrollCells(monthKey, [{ driverId, patch: editPatch(key, value) }]),
    cellOf: ({ driverId, key }) => `${driverId}:${key}`,
    patch: ({ driverId, key, value }) => {
      const had = Object.prototype.hasOwnProperty.call(editsRef.current, driverId);
      const before = editsRef.current[driverId];
      setEdits((current) => ({ ...current, [driverId]: { ...current[driverId], ...editPatch(key, value) } }));
      return () => {
        setEdits((current) => {
          const next = { ...current };
          if (had) next[driverId] = before ?? {};
          else delete next[driverId];
          return next;
        });
      };
    },
    failedMessage: (code) => cellErrorText(code),
  });

  /** A server refusal, in words. `invalid_cell:food_allowance` names the field. */
  function cellErrorText(code: string | undefined): string {
    const field = code?.startsWith("invalid_cell:")
      ? code.slice("invalid_cell:".length)
      : undefined;
    switch (field) {
      case "two_year_applicable":
      case "four_year_applicable":
      case "pending_salary":
      case "traffic_violation":
      case "loan_deduction":
      case "total_allowances":
      case "total_deductions":
        return t("cellErrors.amount");
      case "food_allowance":
        return t("cellErrors.food");
      case "sick_leave_days":
        return t("cellErrors.sick");
      case "vehicle_type":
        return t("vehicleTypeFailed");
      case "bank_code":
        return t("cellErrors.bank");
      case "nationality":
        return t("cellErrors.nationality");
      case "nationality_category":
        return t("cellErrors.nationalityCategory");
      case "restaurant":
        return t("cellErrors.restaurant");
      case "zone":
        return t("cellErrors.zone");
      case "project":
        return t("cellErrors.client");
      default:
        return t("saveFailed");
    }
  }

  /**
   * A vehicle type picked on the sheet. The optimistic draft is what the row
   * prices from; a refused save removes it and puts the stored key back.
   */
  const [vehicleDraft, setVehicleDraft] = useState<Record<string, string>>({});
  /**
   * Bank / zone / client edits, optimistic. The draft holds both the raw keys the
   * pickers bind to and the labels the cells print.
   */
  const [identityDraft, setIdentityDraft] = useState<
    Record<
      string,
      {
        bankNo?: string;
        bank?: string;
        cur?: string;
        zone?: string;
        clientName?: string;
        bankCode?: string;
        zoneId?: string;
        projectKey?: string;
        nationality?: string;
        natCat?: string;
        rest?: string;
        nationalityCode?: string;
        nationalityCategoryKey?: string;
        restaurantId?: string;
      }
    >
  >({});

  const identityWrite = usePayrollCellMutation<
    {
      driverId: string;
      patch: HrIdentityPatch;
      display: {
        bankNo?: string;
        bank?: string;
        cur?: string;
        zone?: string;
        clientName?: string;
        nationality?: string;
        natCat?: string;
        rest?: string;
      };
    },
    { saved: number; skipped: number }
  >({
    mutationFn: ({ driverId, patch }) => saveHrIdentityCells(monthKey, driverId, patch),
    cellOf: ({ driverId, patch }) => `${driverId}:${Object.keys(patch)[0] ?? "identity"}`,
    patch: ({ driverId, patch, display }) => {
      const before = identityDraft[driverId];
      setIdentityDraft((current) => ({
        ...current,
        [driverId]: { ...current[driverId], ...patch, ...display },
      }));
      return () => {
        setIdentityDraft((current) => {
          const next = { ...current };
          if (before === undefined) delete next[driverId];
          else next[driverId] = before;
          return next;
        });
      };
    },
    failedMessage: (code) => cellErrorText(code),
  });
  const vehicleWrite = usePayrollCellMutation<
    { driverId: string; vehicleKey: string },
    { saved: number; skipped: number }
  >({
    mutationFn: ({ driverId, vehicleKey }) => saveHrVehicleType(monthKey, driverId, vehicleKey),
    cellOf: ({ driverId }) => `${driverId}:vehicleType`,
    patch: ({ driverId, vehicleKey }) => {
      const before = vehicleDraft[driverId];
      setVehicleDraft((current) => ({ ...current, [driverId]: vehicleKey }));
      return () => {
        setVehicleDraft((current) => {
          const next = { ...current };
          if (before === undefined) delete next[driverId];
          else next[driverId] = before;
          return next;
        });
      };
    },
    failedMessage: () => t("vehicleTypeFailed"),
  });

  // Another tab saved a payroll or HR cell: this sheet must not keep showing the
  // number the write has already replaced.
  useEffect(() => {
    return subscribePayrollWrites(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    });
  }, [queryClient]);

  /**
   * The shell owns the top action bar; this sheet owns the work. `pageActions` is
   * refreshed after every render and handed to the bridge as one stable ref, so
   * "Export to Excel" and "Clear filters" in the header reach the current view
   * (Payroll / Summary / Config) instead of a stale closure.
   */
  const pageActions = useRef<{ exportNow?: () => void; clearNow?: () => void }>({});
  useRegisterPayrollActions(pageActions);

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  // Refresh the handlers the header's action bar calls (declared below; hoisted).
  useEffect(() => {
    pageActions.current = { exportNow: exportCurrentView, clearNow: clearHrFilters };
  });

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
  const headers = useMemo<Record<string, string>>(() => {
    /**
     * The same canonical wording the Payroll tabs use. Every key still carries
     * the HR translation as its fallback, so a column this map does not own keeps
     * the HR catalogue's own word; the shared ones (MG ID, Client ID, Employee
     * Name, Client, Status, Vehicle Type, Total Salary) cannot drift again.
     */
    const raw: Record<string, string> = {
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
      ahApp: t("cols.ahApp"),
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
    };
    const out: Record<string, string> = {};
    for (const [key, fallback] of Object.entries(raw)) {
      out[key] = payrollColumnLabel(key, fallback);
    }
    return out;
  }, [t]);
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
    () =>
      buildHrPayrollRows({
        // An optimistic type change reprices the row before the callable answers;
        // the refetch then replaces the draft with what was stored.
        riders:
          Object.keys(vehicleDraft).length === 0
            ? riders
            : riders.map((rider) =>
                vehicleDraft[rider.driverId] !== undefined
                  ? { ...rider, vehicleKey: vehicleDraft[rider.driverId] }
                  : rider,
              ),
        bundle,
        monthDays,
        edits,
        statusLabels,
        rates: rateLines,
        noRateLabel: t("noRate"),
        vehicleTypes: vehicleOptions,
        appHours: appHoursQuery.data?.hours,
        identityOverrides: identityDraft,
      }),
    [
      riders,
      bundle,
      monthDays,
      edits,
      statusLabels,
      rateLines,
      t,
      vehicleDraft,
      vehicleOptions,
      appHoursQuery.data,
      identityDraft,
    ],
  );

  /**
   * The two toolbar filters backed by an editable master.
   *
   * The sheet's cells print labels, so these lists are labels: what the sheet
   * holds, then the rest of the catalog. A restaurant or nationality added in
   * Employee Settings is therefore selectable here on the next refresh, before
   * any rider carries it.
   */
  const nationalityFilterValues = useMemo(
    () =>
      masterFilterValues(
        uniqueValues(rows, "nationality", new Set(["—", t("noRate")])),
        identityOptions.nationalities.map((country) => country.label),
      ),
    [rows, identityOptions.nationalities, t],
  );
  const storeFilterValues = useMemo(
    () =>
      masterFilterValues(
        uniqueValues(rows, "rest", new Set(["—", t("noRate")])),
        identityOptions.restaurants.map((restaurant) => restaurant.label),
      ),
    [rows, identityOptions.restaurants, t],
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
    () =>
      filterHrRows(rows, { search, statusKey, filters: [] }).filter(
        // The "Total active riders" card is a filter, not decoration: pressing it
        // narrows the sheet to the same rows it counts.
        (row) => !activeOnly || row.active,
      ),
    [rows, search, statusKey, activeOnly],
  );
  const sheeted = useMemo(() => filterHrSheet(searched, sheetFilters), [searched, sheetFilters]);
  const visible: readonly HrColumn[] = useMemo(() => {
    const byKey = new Map(HR_COLUMNS.map((column) => [column.key, column]));
    const pinned = HR_COLUMNS.filter((column) => identityWidth(column.key) > 0);
    const chosen: HrColumn[] = [];
    for (const id of columns.visibleIds) {
      const column = byKey.get(id);
      if (column) chosen.push(column);
    }
    return [...pinned, ...chosen];
  }, [columns.visibleIds]);
  const filtered = useMemo(
    () => filterHrRowsByColumns(sheeted, colFilters, t("awaiting")),
    [sheeted, colFilters, t],
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

  function saveCell(driverId: string, key: keyof HrEditState, value: number) {
    if (!EDIT_KEYS.has(key)) return;
    cellWrite.mutation.mutate({ driverId, key, value });
  }

  /**
   * Bank / zone / client from the sheet. The display strings are resolved here so
   * the optimistic row prints the label the picker just showed, not the raw key.
   */
  function saveIdentity(driverId: string, patch: HrIdentityPatch) {
    const display: {
      bankNo?: string;
      bank?: string;
      cur?: string;
      zone?: string;
      clientName?: string;
      nationality?: string;
      natCat?: string;
      rest?: string;
    } = {};
    if (patch.bankNumber !== undefined) display.bankNo = patch.bankNumber;
    if (patch.currency !== undefined) display.cur = patch.currency;
    if (patch.bankCode !== undefined) {
      display.bank = identityOptions.banks.find((bank) => bank.value === patch.bankCode)?.label ?? patch.bankCode;
    }
    if (patch.zoneId !== undefined) {
      display.zone = identityOptions.zones.find((zone) => zone.value === patch.zoneId)?.label ?? patch.zoneId;
    }
    if (patch.projectKey !== undefined) {
      display.clientName =
        identityOptions.clients.find((client) => client.value === patch.projectKey)?.label ?? patch.projectKey;
    }
    if (patch.nationalityCode !== undefined) {
      display.nationality =
        identityOptions.nationalities.find((country) => country.value === patch.nationalityCode)?.label ??
        patch.nationalityCode;
    }
    if (patch.nationalityCategoryKey !== undefined) {
      display.natCat =
        identityOptions.nationalityCategories.find(
          (category) => category.value === patch.nationalityCategoryKey,
        )?.label ?? patch.nationalityCategoryKey;
    }
    if (patch.restaurantId !== undefined) {
      display.rest =
        identityOptions.restaurants.find((restaurant) => restaurant.value === patch.restaurantId)?.label ??
        patch.restaurantId;
    }
    identityWrite.mutation.mutate({ driverId, patch, display });
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
        notifyPayrollWrite();
        void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
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
    // The file is the screen: the visible column set, in the visible order, over
    // the rows and sort the grid is actually painting.
    const sheet = orderedRef.current.length > 0 ? orderedRef.current : filtered;
    return sheet.map((row, offset) => {
      const index = offset + 1;
      return visible.map((column) => {
        const raw = column.key === "i" ? String(index) : (row.cells[column.key] ?? "");
        if (raw === HR_AWAITING) return hrExportCell(HR_AWAITING, t("awaiting"));
        return hrExportCell(raw, t("awaiting"));
      });
    });
  }

  async function exportPayroll() {
    const totalColumn = visible.findIndex((column) => column.key === "total");
    const sheet = orderedRef.current.length > 0 ? orderedRef.current : filtered;
    await downloadHrWorkbook({
      filename: `hr-payroll-${monthKey}.xlsx`,
      headers: visible.map((column) => headers[column.key] ?? column.header),
      rows: payrollSheetRows(),
      shortfall:
        totalColumn < 0
          ? undefined
          : {
              column: totalColumn,
              gaps: sheet.map((row) =>
                hrSalaryShortfall(row.numbers.totalSalary, row.permitSalary),
              ),
            },
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

  /**
   * Clear every filter the sheet holds, from the header's shared "Clear filters".
   * The same reset the sheet's own button performs.
   */
  function clearHrFilters() {
    setColFilters({});
    setSearch("");
    setStatusKey("");
    setSheetFilters(EMPTY_HR_SHEET_FILTERS);
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
          <HrPayrollGrid
              columns={visible}
              rows={filtered}
              sourceRows={sheeted}
              filters={colFilters}
              onFilter={(key, next) => {
                setColFilters((current) => {
                  const copy = { ...current };
                  if (!next || !columnFilterActive(next)) delete copy[key];
                  else copy[key] = next;
                  return copy;
                });
              }}
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
              statusList={HR_STATUS_LEGEND_ORDER.map((key) => statusLabels[key])}
              shortfallTitle={(gap) => t("salaryBelowPermit", { amount: formatKwd(gap) })}
              cellStates={cellWrite.cells}
              cellError={cellErrorText}
              vehicleOptions={vehicleOptions}
              noVehicle={t("noVehicle")}
              identityOptions={identityOptions}
              noIdentity={t("emptyIdentity")}
              onIdentity={(driverId, patch) => {
                saveIdentity(driverId, patch);
              }}
              onOrderedRows={(next) => {
                orderedRef.current = next;
              }}
              onVehicleType={(driverId, vehicleKey) => {
                if (!vehicleKey || vehicleKey === rows.find((row) => row.driverId === driverId)?.vehicleKey) return;
                vehicleWrite.mutation.mutate({ driverId, vehicleKey });
              }}
              onSelect={(driverId, key, value) => {
                saveCell(driverId, key, value);
              }}
              onAmount={(driverId, key, value) => {
                saveCell(driverId, key, value);
              }}
              footer={
                <TableFooterExport
                  summary={t("footerSummary", {
                    shown: filtered.length,
                    total: rows.length,
                    month: monthLabel,
                  })}
                  exportLabel={t("footerExport")}
                  onExport={() => {
                    void exportPayroll();
                  }}
                  canExport={filtered.length > 0}
                />
              }
            />
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
            positions={positionOptions}
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
              position: t("config.position"),
              anyPosition: t("config.anyPosition"),
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
      {rangePills ? <div className="hrpay-range-bar">{rangePills}</div> : null}
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
                {nationalityFilterValues.map((value) => (
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
                {storeFilterValues.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="hrpay-legend">
            {HR_STATUS_LEGEND_ORDER.map((key) => {
              const paint = hrStatusPaint(key, key === "cancelled" ? "End of Contract" : "");
              return (
                <button
                  key={key}
                  type="button"
                  className="hrpay-legend-item"
                  data-on={statusKey === key ? "true" : "false"}
                  onClick={() => setStatusKey((current) => (current === key ? "" : key))}
                >
                  <i
                    className="hrpay-legend-dot"
                    data-bordered={paint.bordered ? "true" : undefined}
                    style={paint.bordered ? undefined : { background: paint.fill }}
                  />
                  <span>{statusLabels[key]} - {statusCounts.get(key) ?? 0}</span>
                </button>
              );
            })}
          </div>
          <div className="hrpay-kpis">
            <button
              type="button"
              className="hrpay-kpi hrpay-kpi-lead"
              aria-pressed={!statusKey && !activeOnly}
              title={t("kpiRiders")}
              onClick={() => {
                setStatusKey("");
                setActiveOnly(false);
              }}
            >
              <div className="hrpay-kpi-label">{t("kpiRiders")}</div>
              <div className="hrpay-kpi-value">{monthKpis.riders}</div>
            </button>
            <button
              type="button"
              className="hrpay-kpi hrpay-kpi-lead"
              aria-pressed={activeOnly}
              title={t("kpiActive")}
              onClick={() => setActiveOnly((current) => !current)}
            >
              <div className="hrpay-kpi-label">{t("kpiActive")}</div>
              <div className="hrpay-kpi-value">{monthKpis.active}</div>
            </button>
            <div className="hrpay-kpi" title={t("kpiPayment")}>
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
              <ColumnOrderMenu
                columns={columns}
                labelFor={(id) => headers[id] ?? id}
                labels={{
                  columns: t("columns"),
                  title: tc("title"),
                  hint: tc("hint"),
                  pinned: tc("pinnedHr"),
                  drag: tc("drag"),
                  show: tc("show"),
                  hide: tc("hide"),
                  reset: tc("reset"),
                }}
              />
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
          preview: t("importPreview"),
          previewReady: t("importReady"),
          previewProblems: t("importProblemsCount"),
          previewEmpty: t("importPreviewEmpty"),
          idColumn: t("importIdColumn"),
          amountColumn: t("importAmountColumn"),
          clearFile: t("importClearFile"),
        }}
        onApply={(field, text) => {
          void applyImport(field, text);
        }}
      />
    </div>
  );
}
