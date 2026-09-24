"use server";

import { getSessionUser, type SessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { excelPayloadForRpc, resolveReconRows, type ReconResolvedRow } from "./order-recon-resolve";
import { parseReconXlsx } from "./parse-recon-xlsx";
import type {
  OrderReconKpi,
  OrderReconRun,
  OrderReconRunSummary,
  OrderReconTableRow,
  ReconRowStatus,
} from "./order-recon-types";
import { persistReconKpi } from "./order-recon-views";

async function requireDeliveries(
  kind: "view" | "manage",
): Promise<{ error: "not_authorized" } | { session: SessionUser }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, `deliveries.${kind}`, session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  return { session };
}

export type ReconPreview = {
  fileName: string;
  from: string;
  to: string;
  resolved: ReconResolvedRow[];
  readyCount: number;
  unresolvedCount: number;
};

export async function previewOrderRecon(
  formData: FormData,
): Promise<{ preview: ReconPreview } | { error: string }> {
  const auth = await requireDeliveries("manage");
  if ("error" in auth) return auth;

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "missing_file" };
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseReconXlsx(buffer);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const [{ data: drivers }, { data: restaurants }, { data: aliases }] = await Promise.all([
    supabase.from("drivers").select("id, employee_id").is("archived_at", null),
    supabase.from("restaurants").select("id, name"),
    supabase.from("order_recon_store_aliases").select("alias, restaurant_id"),
  ]);
  const driverIds = (drivers ?? []).map((d) => d.id);
  const { data: profiles } =
    driverIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", driverIds)
      : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const driverRows = (drivers ?? []).map((d) => ({
    id: d.id,
    employee_id: d.employee_id,
    full_name: nameById.get(d.id) ?? null,
  }));

  const resolved = resolveReconRows(
    parsed.rows,
    driverRows,
    restaurants ?? [],
    aliases ?? [],
  );

  return {
    preview: {
      fileName: file.name,
      from: parsed.from,
      to: parsed.to,
      resolved,
      readyCount: resolved.filter((r) => r.status === "ready").length,
      unresolvedCount: resolved.filter((r) => r.status === "unresolved").length,
    },
  };
}

type CompareRow = {
  driver_id: string;
  restaurant_id: string | null;
  work_date: string;
  excel_orders: number;
  app_orders: number;
  difference: number;
};

export async function commitOrderRecon(
  preview: ReconPreview,
): Promise<{ run: OrderReconRun } | { error: string }> {
  const auth = await requireDeliveries("manage");
  if ("error" in auth) return auth;

  const supabase = await createClient();
  const payload = excelPayloadForRpc(preview.resolved);
  const { data, error } = await supabase.rpc("admin_order_recon_compare", {
    p_from: preview.from,
    p_to: preview.to,
    p_excel: payload,
  });
  if (error) return { error: "compare_failed" };

  const compared = (Array.isArray(data) ? data : []) as CompareRow[];
  const restaurantNames = new Map((await supabase.from("restaurants").select("id, name")).data?.map((r) => [r.id, r.name]) ?? []);
  const driverMeta = new Map(
    preview.resolved
      .filter((r) => r.driver_id)
      .map((r) => [r.driver_id!, { employee_id: r.employee_id, employee_name: r.employee_name }]),
  );
  const missingDriverIds = [
    ...new Set(
      compared
        .map((row) => row.driver_id)
        .filter((id): id is string => Boolean(id) && !driverMeta.has(id)),
    ),
  ];
  if (missingDriverIds.length > 0) {
    const { data: extraDrivers } = await supabase
      .from("drivers")
      .select("id, employee_id")
      .in("id", missingDriverIds);
    const extraIds = (extraDrivers ?? []).map((d) => d.id);
    const { data: extraProfiles } =
      extraIds.length > 0
        ? await supabase.from("profiles").select("id, full_name").in("id", extraIds)
        : { data: [] as { id: string; full_name: string | null }[] };
    const extraNames = new Map((extraProfiles ?? []).map((p) => [p.id, p.full_name ?? ""]));
    for (const driver of extraDrivers ?? []) {
      driverMeta.set(driver.id, {
        employee_id: driver.employee_id ?? "",
        employee_name: extraNames.get(driver.id) ?? "",
      });
    }
  }

  const unresolvedRows: OrderReconTableRow[] = preview.resolved
    .filter((r) => r.status === "unresolved")
    .map((r, i) => ({
      id: `u-${i}`,
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      restaurant_name: r.store_name,
      work_date: r.work_date,
      excel_orders: r.excel_orders,
      app_orders: 0,
      difference: 0 - r.excel_orders,
      status: "unresolved" as const,
      driver_id: r.driver_id,
      restaurant_id: r.restaurant_id,
    }));

  const appOnlyCount = compared.filter((row) => {
    const excel = Number(row.excel_orders) || 0;
    const app = Number(row.app_orders) || 0;
    return excel === 0 && app > 0;
  }).length;

  const comparedRows: OrderReconTableRow[] = compared
    .filter((row) => (Number(row.excel_orders) || 0) > 0)
    .map((row, i) => {
      const meta = driverMeta.get(row.driver_id);
      const excel = Number(row.excel_orders) || 0;
      const app = Number(row.app_orders) || 0;
      const status: ReconRowStatus = app === excel ? "match" : "mismatch";
      return {
        id: `c-${i}`,
        employee_id: meta?.employee_id ?? "",
        employee_name: meta?.employee_name ?? "",
        restaurant_name: row.restaurant_id ? restaurantNames.get(row.restaurant_id) ?? "" : "",
        work_date: String(row.work_date).slice(0, 10),
        excel_orders: excel,
        app_orders: app,
        difference: Number(row.difference) || app - excel,
        status,
        driver_id: row.driver_id,
        restaurant_id: row.restaurant_id,
      };
    });

  const rows = [...comparedRows, ...unresolvedRows];
  const kpi: OrderReconKpi = {
    ...persistReconKpi(rows),
    app_only: appOnlyCount,
  };

  const { data: run, error: runError } = await supabase
    .from("order_recon_runs")
    .insert({
      uploaded_by: auth.session.id,
      file_name: preview.fileName,
      from_date: preview.from,
      to_date: preview.to,
      kpi,
    })
    .select("id, created_at")
    .single();
  if (runError || !run) return { error: "save_failed" };

  const insertRows = rows.map((row) => ({
    run_id: run.id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    restaurant_id: row.restaurant_id ?? null,
    restaurant_name: row.restaurant_name,
    driver_id: row.driver_id ?? null,
    work_date: row.work_date,
    excel_orders: row.excel_orders,
    app_orders: row.app_orders,
    difference: row.difference,
    status: row.status,
  }));
  if (insertRows.length > 0) {
    const { error: rowError } = await supabase.from("order_recon_rows").insert(insertRows);
    if (rowError) return { error: "save_failed" };
  }

  const { data: old } = await supabase
    .from("order_recon_runs")
    .select("id")
    .order("created_at", { ascending: false })
    .range(20, 200);
  if (old && old.length > 0) {
    await supabase.from("order_recon_runs").delete().in("id", old.map((r) => r.id));
  }

  return {
    run: {
      id: run.id,
      file_name: preview.fileName,
      from_date: preview.from,
      to_date: preview.to,
      kpi,
      created_at: run.created_at,
      rows: rows.map((row, i) => ({ ...row, id: `${run.id}-${i}` })),
    },
  };
}

async function fetchAllReconRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
) {
  const pageSize = 1000;
  const all: {
    id: string;
    employee_id: string | null;
    employee_name: string | null;
    restaurant_name: string | null;
    restaurant_id: string | null;
    driver_id: string | null;
    work_date: string;
    excel_orders: number;
    app_orders: number;
    difference: number;
    status: string;
  }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("order_recon_rows")
      .select(
        "id, employee_id, employee_name, restaurant_name, restaurant_id, driver_id, work_date, excel_orders, app_orders, difference, status",
      )
      .eq("run_id", runId)
      .order("work_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) break;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

function mapRunRows(
  rows: Awaited<ReturnType<typeof fetchAllReconRows>>,
): OrderReconTableRow[] {
  return rows.map((row) => ({
    id: row.id,
    employee_id: row.employee_id ?? "",
    employee_name: row.employee_name ?? "",
    restaurant_name: row.restaurant_name ?? "",
    restaurant_id: row.restaurant_id,
    driver_id: row.driver_id,
    work_date: row.work_date,
    excel_orders: row.excel_orders,
    app_orders: row.app_orders,
    difference: row.difference,
    status: row.status as ReconRowStatus,
  }));
}

export async function listOrderReconRuns(): Promise<OrderReconRunSummary[]> {
  const auth = await requireDeliveries("view");
  if ("error" in auth) return [];

  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("order_recon_runs")
    .select("id, file_name, from_date, to_date, kpi, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (runs ?? []).map((run) => ({
    id: run.id,
    file_name: run.file_name,
    from_date: run.from_date,
    to_date: run.to_date,
    kpi: run.kpi as OrderReconKpi,
    created_at: run.created_at,
  }));
}

export async function getOrderRecon(runId: string): Promise<OrderReconRun | null> {
  const auth = await requireDeliveries("view");
  if ("error" in auth) return null;

  const supabase = await createClient();
  const { data: run } = await supabase
    .from("order_recon_runs")
    .select("id, file_name, from_date, to_date, kpi, created_at")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return null;

  const rows = await fetchAllReconRows(supabase, run.id);
  return {
    id: run.id,
    file_name: run.file_name,
    from_date: run.from_date,
    to_date: run.to_date,
    kpi: run.kpi as OrderReconKpi,
    created_at: run.created_at,
    rows: mapRunRows(rows),
  };
}

export async function getLatestOrderRecon(): Promise<OrderReconRun | null> {
  const auth = await requireDeliveries("view");
  if ("error" in auth) return null;

  const supabase = await createClient();
  const { data: run } = await supabase
    .from("order_recon_runs")
    .select("id, file_name, from_date, to_date, kpi, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return null;

  const rows = await fetchAllReconRows(supabase, run.id);
  return {
    id: run.id,
    file_name: run.file_name,
    from_date: run.from_date,
    to_date: run.to_date,
    kpi: run.kpi as OrderReconKpi,
    created_at: run.created_at,
    rows: mapRunRows(rows),
  };
}
