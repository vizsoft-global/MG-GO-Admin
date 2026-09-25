"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import {
  DEFAULT_DRIVERS_SORT,
  isDriversFilterColumn,
  mapDriversPageRow,
  sanitizeDriversFilters,
  type DriversColumnFilters,
  type DriversFilterOption,
  type DriversPageKpis,
  type DriversSort,
  type DriversTab,
} from "./drivers-list-query";
import type { DriverListPageRow } from "./types";

const TABS = new Set<DriversTab>(["all", "pending", "on_duty", "multi_device", "archived"]);
const EXPORT_LIMIT = 5000;

async function requireDriversView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
}

export type DriversPageQuery = {
  tab: DriversTab;
  search: string;
  filters: DriversColumnFilters;
  sort: DriversSort;
};

export type DriversPageResult = {
  rows: DriverListPageRow[];
  filteredTotal: number;
  tabTotal: number;
  kpis: DriversPageKpis;
};

function normalizeQuery(query: DriversPageQuery) {
  const sortKey = isDriversFilterColumn(query.sort.key) ? query.sort.key : DEFAULT_DRIVERS_SORT.key;
  return {
    p_tab: TABS.has(query.tab) ? query.tab : "all",
    p_search: query.search.trim().slice(0, 200) || undefined,
    p_filters: sanitizeDriversFilters(query.filters) as unknown as Json,
    p_sort_key: sortKey,
    p_sort_dir: query.sort.dir === "desc" ? "desc" : "asc",
  };
}

async function callPage(
  query: DriversPageQuery,
  limit: number,
  offset: number,
): Promise<DriversPageResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_drivers_page", {
    ...normalizeQuery(query),
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as {
    rows?: Record<string, unknown>[];
    filtered_total?: number;
    tab_total?: number;
    kpis?: DriversPageKpis;
  };
  return {
    rows: (payload.rows ?? []).map(mapDriversPageRow),
    filteredTotal: payload.filtered_total ?? 0,
    tabTotal: payload.tab_total ?? 0,
    kpis: payload.kpis ?? {
      total: 0,
      activeToday: 0,
      onlineNow: 0,
      inactive: 0,
      pendingVerification: 0,
      suspended: 0,
    },
  };
}

export async function fetchDriversPage(
  query: DriversPageQuery,
  offset: number,
  limit = 100,
): Promise<DriversPageResult> {
  await requireDriversView();
  if (offset === 0) {
    void logAdminRead("driver_intakes", "fetchDriversPage", {
      tab: query.tab,
      filterCount: Object.keys(query.filters).length,
    });
  }
  return callPage(query, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
}

export async function fetchDriverFilterValues(
  column: string,
  query: Omit<DriversPageQuery, "sort">,
): Promise<DriversFilterOption[]> {
  await requireDriversView();
  if (!isDriversFilterColumn(column)) throw new Error("invalid_filter");
  const supabase = await createClient();
  const { p_tab, p_search, p_filters } = normalizeQuery({ ...query, sort: DEFAULT_DRIVERS_SORT });
  const { data, error } = await supabase.rpc("admin_drivers_filter_values", {
    p_column: column,
    p_tab,
    p_search,
    p_filters,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { value: unknown; label: unknown }[]).map((o) => ({
    value: String(o.value ?? ""),
    label: typeof o.label === "string" ? o.label : null,
  }));
}

/** Every row matching the current view, for CSV export (capped; `truncated` says so). */
export async function fetchDriversForExport(
  query: DriversPageQuery,
): Promise<{ rows: DriverListPageRow[]; truncated: boolean }> {
  await requireDriversView();
  void logAdminRead("driver_intakes", "fetchDriversForExport", { tab: query.tab });
  const result = await callPage(query, EXPORT_LIMIT, 0);
  return { rows: result.rows, truncated: result.filteredTotal > result.rows.length };
}
