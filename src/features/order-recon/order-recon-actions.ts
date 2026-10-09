"use server";

import { getSessionUser, type SessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  collapseReconIssues,
  excelPayloadForRpc,
  resolveReconRows,
  type ReconIssueRow,
  type ReconResolvedRow,
} from "./order-recon-resolve";
import { parseReconXlsx } from "./parse-recon-xlsx";
import type {
  OrderReconKpi,
  OrderReconRun,
  OrderReconRunSummary,
  OrderReconTableRow,
  OrderReconImportStatus,
  ReconRowStatus,
} from "./order-recon-types";
import { persistReconKpi } from "./order-recon-views";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { nextUndoSeq, redoTargetId, undoTargetId, type ReconImportTip } from "./recon-import-stack";

async function requireOrderRecon(
  kind: "view" | "manage",
): Promise<{ error: "not_authorized" } | { session: SessionUser }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, `order_recon.${kind}`, session.isSuperAdmin)
  ) {
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

async function reconDb() {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

function asImportStatus(value: string | null | undefined): OrderReconImportStatus {
  return value === "undone" ? "undone" : "applied";
}

function mapRunSummary(run: {
  id: string;
  file_name: string;
  from_date: string;
  to_date: string;
  kpi: OrderReconKpi | null;
  created_at: string;
  status?: string | null;
  undo_seq?: number | null;
  redoable?: boolean | null;
}): OrderReconRunSummary {
  return {
    id: run.id,
    file_name: run.file_name,
    from_date: run.from_date,
    to_date: run.to_date,
    kpi: (run.kpi ?? persistReconKpi([])) as OrderReconKpi,
    created_at: run.created_at,
    status: asImportStatus(run.status),
    undo_seq: run.undo_seq ?? null,
    redoable: run.redoable !== false,
  };
}

function asTips(runs: OrderReconRunSummary[]): ReconImportTip[] {
  return runs.map((run) => ({
    id: run.id,
    status: run.status,
    createdAt: run.created_at,
    undoSeq: run.undo_seq,
    redoable: run.redoable,
  }));
}

export type ReconPreview = {
  fileName: string;
  from: string;
  to: string;
  resolved: ReconResolvedRow[];
  issues: ReconIssueRow[];
  readyCount: number;
  unresolvedCount: number;
};

export async function previewOrderRecon(
  formData: FormData,
): Promise<{ preview: ReconPreview } | { error: string }> {
  const auth = await requireOrderRecon("manage");
  if ("error" in auth) return auth;

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "missing_file" };
  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseReconXlsx(buffer);
  if (!parsed.ok) return { error: parsed.error };

  const db = await reconDb();
  const [driverSnap, restaurantSnap, aliasSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
    db.collection(COLLECTIONS.restaurants).get(),
    db.collection("order_recon_store_aliases").get(),
  ]);
  const drivers = driverSnap.docs.map((doc) => ({
    id: doc.id,
    employee_id: (doc.data().employee_id as string | null) ?? null,
  }));
  const restaurants = restaurantSnap.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.data().name ?? ""),
  }));
  const aliases = aliasSnap.docs.map((doc) => ({
    alias: String(doc.data().alias ?? ""),
    restaurant_id: String(doc.data().restaurant_id ?? ""),
  }));
  const driverIds = drivers.map((d) => d.id);
  const nameById = new Map<string, string | null>();
  for (let i = 0; i < driverIds.length; i += 100) {
    const refs = driverIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.profiles).doc(id));
    const found = refs.length ? await db.getAll(...refs) : [];
    for (const doc of found) {
      if (!doc.exists) continue;
      nameById.set(doc.id, (doc.data()?.full_name as string | null) ?? null);
    }
  }
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

  const issues = collapseReconIssues(resolved);

  return {
    preview: {
      fileName: file.name,
      from: parsed.from,
      to: parsed.to,
      resolved,
      issues,
      readyCount: resolved.filter((r) => r.status === "ready").length,
      // Grouped count: the list below the header shows one line per issue, so a
      // per-cell count would contradict it and inflate one unknown rider into 30.
      unresolvedCount: issues.length,
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
  const auth = await requireOrderRecon("manage");
  if ("error" in auth) return auth;

  const db = await reconDb();
  const payload = excelPayloadForRpc(preview.resolved);
  const { data, error } = await callAdminFunction("admin_order_recon_compare", rpcArgs({
    p_from: preview.from,
    p_to: preview.to,
    p_excel: payload,
  }));
  if (error) return { error: "compare_failed" };

  const compared = (Array.isArray(data) ? data : []) as CompareRow[];
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).get();
  const restaurantNames = new Map(restaurantSnap.docs.map((doc) => [doc.id, String(doc.data().name ?? "")]));
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
    const extraDrivers: { id: string; employee_id: string | null }[] = [];
    for (let i = 0; i < missingDriverIds.length; i += 100) {
      const refs = missingDriverIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.drivers).doc(id));
      const found = refs.length ? await db.getAll(...refs) : [];
      for (const doc of found) {
        if (!doc.exists) continue;
        extraDrivers.push({ id: doc.id, employee_id: (doc.data()?.employee_id as string | null) ?? null });
      }
    }
    const extraIds = extraDrivers.map((d) => d.id);
    const extraNames = new Map<string, string>();
    for (let i = 0; i < extraIds.length; i += 100) {
      const refs = extraIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.profiles).doc(id));
      const found = refs.length ? await db.getAll(...refs) : [];
      for (const doc of found) {
        if (!doc.exists) continue;
        extraNames.set(doc.id, String(doc.data()?.full_name ?? ""));
      }
    }
    for (const driver of extraDrivers) {
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

  const runRef = db.collection(COLLECTIONS.orderReconRuns).doc();
  const createdAt = new Date().toISOString();
  try {
    await runRef.set({
      uploaded_by: auth.session.id,
      file_name: preview.fileName,
      from_date: preview.from,
      to_date: preview.to,
      kpi,
      status: "applied",
      redoable: true,
      created_at: createdAt,
    });
  } catch {
    return { error: "save_failed" };
  }
  const run = { id: runRef.id, created_at: createdAt };

  const undoneSnap = await db.collection(COLLECTIONS.orderReconRuns).where("status", "==", "undone").get();
  for (const doc of undoneSnap.docs) {
    if (doc.id === run.id) continue;
    await doc.ref.set({ redoable: false }, { merge: true });
  }

  void logAdminMutation({
    action: "create",
    entityType: "order_recon_run",
    entityId: run.id,
    routeName: "/deliveries/reconciliation",
    after: { fileName: preview.fileName, from: preview.from, to: preview.to },
  });

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
    try {
      for (let i = 0; i < insertRows.length; i += 400) {
        const batch = db.batch();
        for (const row of insertRows.slice(i, i + 400)) {
          batch.set(db.collection(COLLECTIONS.orderReconRows).doc(), row);
        }
        await batch.commit();
      }
    } catch {
      return { error: "save_failed" };
    }
  }

  const allRuns = await db.collection(COLLECTIONS.orderReconRuns).get();
  const stale = allRuns.docs
    .map((doc) => ({ id: doc.id, created_at: isoOf(doc.data().created_at) ?? "" }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(20);
  if (stale.length > 0) {
    const batch = db.batch();
    for (const row of stale) batch.delete(db.collection(COLLECTIONS.orderReconRuns).doc(row.id));
    await batch.commit();
  }

  return {
    run: {
      id: run.id,
      file_name: preview.fileName,
      from_date: preview.from,
      to_date: preview.to,
      kpi,
      created_at: run.created_at,
      status: "applied",
      undo_seq: null,
      redoable: true,
      rows: rows.map((row, i) => ({ ...row, id: `${run.id}-${i}` })),
    },
  };
}

function mapStoredRun(doc: DocumentSnapshot): OrderReconRunSummary | null {
  if (!doc.exists) return null;
  const row = doc.data() ?? {};
  return mapRunSummary({
    id: doc.id,
    file_name: String(row.file_name ?? ""),
    from_date: String(row.from_date ?? ""),
    to_date: String(row.to_date ?? ""),
    kpi: (row.kpi ?? null) as OrderReconKpi | null,
    created_at: isoOf(row.created_at) ?? "",
    status: (row.status as string | null) ?? null,
    undo_seq: (row.undo_seq as number | null) ?? null,
    redoable: (row.redoable as boolean | null) ?? null,
  });
}

async function fetchAllReconRows(runId: string) {
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
  const db = await reconDb();
  const snap = await db.collection(COLLECTIONS.orderReconRows).where("run_id", "==", runId).get();
  const mapped = snap.docs.map((doc) => {
    const row = doc.data();
    return {
      id: doc.id,
      employee_id: (row.employee_id as string | null) ?? null,
      employee_name: (row.employee_name as string | null) ?? null,
      restaurant_name: (row.restaurant_name as string | null) ?? null,
      restaurant_id: (row.restaurant_id as string | null) ?? null,
      driver_id: (row.driver_id as string | null) ?? null,
      work_date: String(row.work_date ?? ""),
      excel_orders: Number(row.excel_orders ?? 0),
      app_orders: Number(row.app_orders ?? 0),
      difference: Number(row.difference ?? 0),
      status: String(row.status ?? ""),
    };
  });
  mapped.sort((a, b) => a.work_date.localeCompare(b.work_date));
  all.push(...mapped);
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
  const auth = await requireOrderRecon("view");
  if ("error" in auth) return [];

  const db = await reconDb();
  const snap = await db.collection(COLLECTIONS.orderReconRuns).get();
  return snap.docs
    .map((doc) => mapStoredRun(doc))
    .filter((run): run is OrderReconRunSummary => run != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);
}

export async function getOrderRecon(runId: string): Promise<OrderReconRun | null> {
  const auth = await requireOrderRecon("view");
  if ("error" in auth) return null;

  const db = await reconDb();
  const doc = await db.collection(COLLECTIONS.orderReconRuns).doc(runId).get();
  const run = mapStoredRun(doc);
  if (!run) return null;
  const rows = await fetchAllReconRows(run.id);
  return { ...run, rows: mapRunRows(rows) };
}

export async function getLatestOrderRecon(): Promise<OrderReconRun | null> {
  const auth = await requireOrderRecon("view");
  if ("error" in auth) return null;

  const db = await reconDb();
  const snap = await db.collection(COLLECTIONS.orderReconRuns).where("status", "==", "applied").get();
  const run = snap.docs
    .map((doc) => mapStoredRun(doc))
    .filter((row): row is OrderReconRunSummary => row != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!run) return null;
  const rows = await fetchAllReconRows(run.id);
  return { ...run, rows: mapRunRows(rows) };
}

export async function undoOrderReconImport(): Promise<{ error?: string }> {
  return replayReconImport("undo");
}

export async function redoOrderReconImport(): Promise<{ error?: string }> {
  return replayReconImport("redo");
}

async function replayReconImport(direction: "undo" | "redo"): Promise<{ error?: string }> {
  const auth = await requireOrderRecon("manage");
  if ("error" in auth) return auth;

  const runs = await listOrderReconRuns();
  const target = direction === "undo" ? undoTargetId(asTips(runs)) : redoTargetId(asTips(runs));
  if (!target) return { error: direction === "undo" ? "nothing_to_undo" : "nothing_to_redo" };

  const db = await reconDb();
  const seq = nextUndoSeq(asTips(runs));
  const patch =
    direction === "undo"
      ? {
          status: "undone",
          undone_at: new Date().toISOString(),
          undo_seq: seq,
          redoable: true,
        }
      : {
          status: "applied",
          undone_at: null,
          redoable: true,
        };
  try {
    await db.collection(COLLECTIONS.orderReconRuns).doc(target).set(patch, { merge: true });
  } catch {
    return { error: "save_failed" };
  }

  void logAdminMutation({
    action: "update",
    entityType: "order_recon_run",
    entityId: target,
    routeName: "/deliveries/reconciliation",
    after: { direction },
  });
  return {};
}
