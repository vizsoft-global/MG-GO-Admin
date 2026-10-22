"use server";

import { getSessionUser, type SessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type {
  Firestore,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  daysInRange,
  monthContaining,
  parseComparisonSnapshot,
  spanDays,
  type ComparisonSnapshot,
} from "./order-comparison-model";
import {
  ComparisonReadCapError,
  failureCode,
} from "./order-comparison-errors";
import { deliveryDayBounds } from "./order-comparison-range";

const MAX_SPAN = 93;
const PAGE = 1000;
/**
 * One fallback read may not page past this many documents. Sized above the
 * page's own 93-day maximum (~257k deliveries in October 2026), so a stale lane
 * cannot preempt a range the UI itself allows.
 */
const FALLBACK_DOCS_CAP = 300_000;

async function requireView(): Promise<{ error: "not_authorized" } | { session: SessionUser }> {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "order_recon.view", session.isSuperAdmin)) {
    return { error: "not_authorized" };
  }
  return { session };
}

function isoOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return null;
}

function rpcArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  for (const [key, value] of Object.entries(args)) {
    if (!key.startsWith("p_")) continue;
    const camel = key.slice(2).replace(/_([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());
    if (out[camel] === undefined) out[camel] = value;
  }
  return out;
}

async function pageRange(
  db: Firestore,
  collection: string,
  field: string,
  start: string | Date,
  end: string | Date,
  endInclusive: boolean,
): Promise<QueryDocumentSnapshot[]> {
  const docs: QueryDocumentSnapshot[] = [];
  // Cursor pagination, not `offset`: an offset re-bills every skipped document,
  // and a month is ~111k rows. `startAfter` reads each page once.
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query: Query = db
      .collection(collection)
      .where(field, ">=", start)
      .where(field, endInclusive ? "<=" : "<", end)
      .orderBy(field)
      .limit(PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    docs.push(...snap.docs);
    if (docs.length > FALLBACK_DOCS_CAP) throw new ComparisonReadCapError();
    if (snap.size < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) break;
  }
  return docs;
}

async function loadSnapshotFallback(
  db: Firestore,
  from: string,
  to: string,
): Promise<ComparisonSnapshot> {
  const rowDocs = await pageRange(db, COLLECTIONS.orderReconRows, "work_date", from, to, true);
  let docsRead = rowDocs.length;
  // Every read the fallback makes is charged here, so a wide month cannot page
  // the whole database: past the cap the caller answers `scan_cap_exceeded`.
  const charge = (count: number) => {
    docsRead += count;
    if (docsRead > FALLBACK_DOCS_CAP) throw new ComparisonReadCapError();
  };
  const rowPage = rowDocs.map((doc) => {
    const row = doc.data();
    return {
      employee_id: (row.employee_id as string | null) ?? null,
      employee_name: (row.employee_name as string | null) ?? null,
      excel_orders: Number(row.excel_orders ?? 0),
      work_date: String(row.work_date ?? ""),
      run_id: String(row.run_id ?? ""),
    };
  });

  const runIds = [...new Set(rowPage.map((r) => r.run_id).filter(Boolean))];
  const runs: { id: string; created_at: string; status: string }[] = [];
  for (let i = 0; i < runIds.length; i += 100) {
    const refs = runIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.orderReconRuns).doc(id));
    const found = refs.length ? await db.getAll(...refs) : [];
    charge(found.length);
    for (const doc of found) {
      if (!doc.exists) continue;
      const row = doc.data() ?? {};
      runs.push({
        id: doc.id,
        created_at: isoOf(row.created_at) ?? "",
        status: String(row.status ?? ""),
      });
    }
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

  // `delivered_at` is a Timestamp: the old fallback sent an ISO string, which is
  // why the fallback matched nothing. Day bounds are real Dates now.
  const bounds = deliveryDayBounds(from, to);
  const deliveryDocs = await pageRange(
    db,
    COLLECTIONS.deliveries,
    "delivered_at",
    bounds.start,
    bounds.endExclusive,
    false,
  );
  charge(deliveryDocs.length);
  const allowed = new Set(["pending", "in_transit", "verified"]);
  const deliveries = deliveryDocs
    .map((doc) => doc.data())
    .filter((row) => allowed.has(String(row.status ?? "")) && row.delivered_at != null)
    .map((row) => ({
      driver_id: String(row.driver_id ?? ""),
      delivered_at: isoOf(row.delivered_at) ?? "",
    }))
    .filter((row) => row.driver_id && row.delivered_at);

  const driverIds = [...new Set(deliveries.map((d) => d.driver_id))];
  const drivers: { id: string; employee_id: string | null }[] = [];
  for (let i = 0; i < driverIds.length; i += 100) {
    const refs = driverIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.drivers).doc(id));
    const found = refs.length ? await db.getAll(...refs) : [];
    charge(found.length);
    for (const doc of found) {
      if (!doc.exists) continue;
      drivers.push({ id: doc.id, employee_id: (doc.data()?.employee_id as string | null) ?? null });
    }
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
  const liveSnap = await db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get();
  charge(liveSnap.size);
  for (const doc of liveSnap.docs) {
    const employeeId = doc.data().employee_id as string | null;
    if (employeeId && wanted.includes(employeeId.trim().toLowerCase())) {
      riderRows.push({ id: doc.id, employee_id: employeeId });
    }
  }
  const profileIds = riderRows.map((d) => d.id);
  const names = new Map<string, string>();
  for (let i = 0; i < profileIds.length; i += 100) {
    const refs = profileIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.profiles).doc(id));
    const found = refs.length ? await db.getAll(...refs) : [];
    charge(found.length);
    for (const doc of found) {
      if (!doc.exists) continue;
      names.set(doc.id, String(doc.data()?.full_name ?? ""));
    }
  }
  const restName = new Map<string, string>();
  for (let i = 0; i < profileIds.length; i += 30) {
    const ids = profileIds.slice(i, i + 30);
    const mapSnap = await db.collection(COLLECTIONS.driverRestaurants).where("driver_id", "in", ids).get();
    charge(mapSnap.size);
    const maps = mapSnap.docs.map((doc) => ({
      driver_id: String(doc.data().driver_id ?? ""),
      restaurant_id: String(doc.data().restaurant_id ?? ""),
    }));
    const restIds = [...new Set(maps.map((m) => m.restaurant_id).filter(Boolean))];
    const restRefs = restIds.map((id) => db.collection(COLLECTIONS.restaurants).doc(id));
    const restDocs = restRefs.length ? await db.getAll(...restRefs) : [];
    charge(restDocs.length);
    const byId = new Map(
      restDocs.filter((doc) => doc.exists).map((doc) => [doc.id, String(doc.data()?.name ?? "")]),
    );
    const grouped = new Map<string, string[]>();
    for (const m of maps) {
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

  console.info(JSON.stringify({ perf: "handler", name: "loadSnapshotFallback", docsRead }));

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

  const db = await staffDb();
  if (!db) return { error: "not_configured" };
  const { data, error } = await callAdminFunction("admin_order_comparison_snapshot", rpcArgs({
    p_from: from,
    p_to: to,
  }));
  if (!error) {
    return { snapshot: parseComparisonSnapshot(data, from, to) };
  }

  // Name the real failure instead of collapsing everything into compare_failed.
  // The one line below is what turns "the page is broken" into a status code in
  // the Vercel log on the next report.
  const code = failureCode(error);
  console.error("getOrderComparison failed", {
    from,
    to,
    code,
    status: error.code ?? null,
    message: error.message ?? null,
  });
  if (code !== "service_stale") return { error: code };

  // The deployed lane does not know the function yet (wrong lane / stale
  // deploy). Read the same window locally instead of failing a page that used to
  // work — up to MAX_SPAN days, with the read cap enforced inside.
  try {
    return { snapshot: await loadSnapshotFallback(db, from, to) };
  } catch (fallbackError) {
    if (fallbackError instanceof ComparisonReadCapError) return { error: "scan_cap_exceeded" };
    console.error("getOrderComparison fallback failed", {
      from,
      to,
      message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    });
    return { error: "compare_failed" };
  }
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
