"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  daysInRange,
  monthContaining,
  parseComparisonSnapshot,
  spanDays,
  type ComparisonSnapshot,
} from "./order-comparison-model";
import { addKuwaitDays } from "@/lib/date/kuwait-dates";

const MAX_SPAN = 93;
const PAGE = 1000;

function rpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("admin_order_comparison_snapshot") ||
    message.includes("could not find the function")
  );
}

async function requireView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "deliveries.view", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

async function pageAll<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) break;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

async function loadSnapshotFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  from: string,
  to: string,
): Promise<ComparisonSnapshot> {
  const rowPage = await pageAll<{
    employee_id: string | null;
    employee_name: string | null;
    excel_orders: number;
    work_date: string;
    run_id: string;
  }>((start, end) =>
    supabase
      .from("order_recon_rows")
      .select("employee_id, employee_name, excel_orders, work_date, run_id")
      .gte("work_date", from)
      .lte("work_date", to)
      .range(start, end),
  );

  const runIds = [...new Set(rowPage.map((r) => r.run_id))];
  const runs: { id: string; created_at: string; status: string }[] = [];
  for (let i = 0; i < runIds.length; i += 100) {
    const chunk = runIds.slice(i, i + 100);
    const { data } = await supabase
      .from("order_recon_runs")
      .select("id, created_at, status")
      .in("id", chunk);
    runs.push(...((data ?? []) as { id: string; created_at: string; status: string }[]));
  }
  const appliedAt = new Map(
    runs.filter((r) => r.status === "applied").map((r) => [r.id, r.created_at]),
  );

  type Pick = { runId: string; created: string; raw: string; name: string };
  const latest = new Map<string, Pick>();
  for (const row of rowPage) {
    const created = appliedAt.get(row.run_id);
    if (!created) continue;
    const raw = String(row.employee_id ?? "").trim();
    if (!raw) continue;
    const key = `${raw.toLowerCase()}|${String(row.work_date).slice(0, 10)}`;
    const prev = latest.get(key);
    if (!prev || created > prev.created) {
      latest.set(key, { runId: row.run_id, created, raw, name: row.employee_name ?? "" });
    }
  }
  const amSum = new Map<string, { mg_id: string; work_date: string; orders: number; rider_name: string }>();
  for (const row of rowPage) {
    const day = String(row.work_date).slice(0, 10);
    const raw = String(row.employee_id ?? "").trim();
    if (!raw) continue;
    const key = `${raw.toLowerCase()}|${day}`;
    const pick = latest.get(key);
    if (!pick || pick.runId !== row.run_id) continue;
    const acc = amSum.get(key);
    const orders = Number(row.excel_orders) || 0;
    if (acc) acc.orders += orders;
    else amSum.set(key, { mg_id: pick.raw, work_date: day, orders, rider_name: pick.name });
  }

  const startIso = `${from}T00:00:00+03:00`;
  const endIso = `${addKuwaitDays(to, 1)}T00:00:00+03:00`;
  const deliveries = await pageAll<{ driver_id: string; delivered_at: string }>((start, end) =>
    supabase
      .from("deliveries")
      .select("driver_id, delivered_at")
      .in("status", ["pending", "in_transit", "verified"])
      .not("delivered_at", "is", null)
      .gte("delivered_at", startIso)
      .lt("delivered_at", endIso)
      .range(start, end),
  );

  const driverIds = [...new Set(deliveries.map((d) => d.driver_id))];
  const drivers: { id: string; employee_id: string | null }[] = [];
  for (let i = 0; i < driverIds.length; i += 100) {
    const { data } = await supabase
      .from("drivers")
      .select("id, employee_id")
      .in("id", driverIds.slice(i, i + 100));
    drivers.push(...((data ?? []) as { id: string; employee_id: string | null }[]));
  }
  const empByDriver = new Map(drivers.map((d) => [d.id, d.employee_id ?? ""]));
  const mggoSum = new Map<string, { mg_id: string; work_date: string; orders: number }>();
  for (const row of deliveries) {
    const emp = empByDriver.get(row.driver_id)?.trim();
    if (!emp) continue;
    const work_date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuwait",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(row.delivered_at));
    if (work_date < from || work_date > to) continue;
    const key = `${emp.toLowerCase()}|${work_date}`;
    const acc = mggoSum.get(key);
    if (acc) acc.orders += 1;
    else mggoSum.set(key, { mg_id: emp, work_date, orders: 1 });
  }

  const amIds = [...amSum.values()].map((r) => r.mg_id);
  const mgIds = [...mggoSum.values()].map((r) => r.mg_id);
  const wanted = [...new Set([...amIds, ...mgIds].map((id) => id.toLowerCase()))];
  const riderRows: { id: string; employee_id: string | null }[] = [];
  const { data: liveDrivers } = await supabase
    .from("drivers")
    .select("id, employee_id")
    .is("archived_at", null);
  for (const d of liveDrivers ?? []) {
    if (d.employee_id && wanted.includes(d.employee_id.trim().toLowerCase())) {
      riderRows.push(d);
    }
  }
  const profileIds = riderRows.map((d) => d.id);
  const names = new Map<string, string>();
  for (let i = 0; i < profileIds.length; i += 100) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds.slice(i, i + 100));
    for (const p of data ?? []) names.set(p.id, p.full_name ?? "");
  }
  const restName = new Map<string, string>();
  for (let i = 0; i < profileIds.length; i += 100) {
    const ids = profileIds.slice(i, i + 100);
    const { data: maps } = await supabase
      .from("driver_restaurants")
      .select("driver_id, restaurant_id")
      .in("driver_id", ids);
    const restIds = [...new Set((maps ?? []).map((m) => m.restaurant_id))];
    const { data: rests } =
      restIds.length > 0
        ? await supabase.from("restaurants").select("id, name").in("id", restIds)
        : { data: [] as { id: string; name: string }[] };
    const byId = new Map((rests ?? []).map((r) => [r.id, r.name]));
    const grouped = new Map<string, string[]>();
    for (const m of maps ?? []) {
      const name = byId.get(m.restaurant_id);
      if (!name) continue;
      const list = grouped.get(m.driver_id) ?? [];
      list.push(name);
      grouped.set(m.driver_id, list);
    }
    for (const [driverId, list] of grouped) {
      list.sort((a, b) => a.localeCompare(b));
      restName.set(driverId, list[0] ?? "—");
    }
  }

  return {
    from,
    to,
    am: [...amSum.values()],
    mggo: [...mggoSum.values()],
    riders: riderRows.map((d) => ({
      mg_id: d.employee_id ?? "",
      driver_id: d.id,
      rider_name: names.get(d.id) ?? "",
      restaurant_name: restName.get(d.id) ?? "—",
    })),
  };
}

export async function getOrderComparison(input: {
  from: string;
  to: string;
}): Promise<{ snapshot: ComparisonSnapshot } | { error: string }> {
  const auth = await requireView();
  if ("error" in auth) return auth;
  const from = input.from;
  const to = input.to;
  if (!from || !to || to < from) return { error: "invalid_range" };
  if (spanDays(from, to) > MAX_SPAN) return { error: "range_too_large" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_order_comparison_snapshot", {
    p_from: from,
    p_to: to,
  });
  if (!error) {
    return { snapshot: parseComparisonSnapshot(data, from, to) };
  }
  if (!rpcMissing(error)) return { error: "compare_failed" };
  // Fallback pages deliveries 1k at a time. A Kuwait month on prod is ~100k rows
  // and hangs the server action; keep the table scan to a short window until the RPC is live.
  if (spanDays(from, to) > 3) return { error: "compare_failed" };
  return { snapshot: await loadSnapshotFallback(supabase, from, to) };
}

export async function exportComparisonMonth(monthStart: string): Promise<
  { snapshot: ComparisonSnapshot; days: string[]; year: number; month: number } | { error: string }
> {
  const month = monthContaining(monthStart);
  const result = await getOrderComparison({ from: month.from, to: month.to });
  if ("error" in result) return result;
  return {
    snapshot: result.snapshot,
    days: daysInRange(month.from, month.to),
    year: month.year,
    month: month.month,
  };
}
