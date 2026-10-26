"use server";

import type { DocumentData } from "firebase-admin/firestore";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/get-session";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  expandHrRateLines,
  isHrVehicle,
  type HrRateEvent,
  type HrRateLine,
} from "./hr-rate";

const CATALOG = "payroll_hr_rates";
const HISTORY = "payroll_hr_rate_history";

export type HrRateCatalog = {
  lines: HrRateLine[];
  history: HrRateEvent[];
};

function parseLine(value: unknown): HrRateLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const vehicle = typeof row.vehicle === "string" ? row.vehicle : "";
  const project = typeof row.project === "string" ? row.project.trim() : "";
  const rate = typeof row.rate === "number" ? row.rate : Number(row.rate);
  const zones = Array.isArray(row.zones)
    ? row.zones.filter((zone): zone is string => typeof zone === "string" && zone.trim() !== "").map((zone) => zone.trim())
    : [];
  if (!isHrVehicle(vehicle) || !project || !Number.isFinite(rate) || rate < 0 || zones.length === 0) return null;
  const id = typeof row.id === "string" && row.id ? row.id : `${vehicle}-${project}`;
  return { id, vehicle, project, zones, rate };
}

function parseEvent(id: string, value: DocumentData): HrRateEvent | null {
  const field = value.field;
  if (field !== "Rate" && field !== "Rate added" && field !== "Rate removed") return null;
  return {
    id,
    at: typeof value.at === "string" ? value.at : "",
    by: typeof value.by === "string" ? value.by : "",
    item: typeof value.item === "string" ? value.item : "",
    field,
    from: typeof value.from === "string" ? value.from : "—",
    to: typeof value.to === "string" ? value.to : "—",
  };
}

async function canRead(): Promise<boolean> {
  const session = await getSessionUser();
  if (!session) return false;
  return (
    session.isSuperAdmin ||
    hasPermissionInSet(session.permissions, "payroll.hr_payroll", false) ||
    hasPermissionInSet(session.permissions, "payroll.manage", false)
  );
}

export async function listHrRateCatalog(): Promise<HrRateCatalog> {
  if (!(await canRead())) throw new Error("not_authorized");
  const db = await staffDb();
  if (!db) return { lines: [], history: [] };
  const [catalog, history] = await Promise.all([
    db.collection(CATALOG).doc("catalog").get(),
    db.collection(HISTORY).orderBy("at", "desc").limit(200).get(),
  ]);
  const raw = catalog.data()?.lines;
  const lines = Array.isArray(raw) ? raw.map(parseLine).filter((line): line is HrRateLine => line !== null) : [];
  return {
    lines,
    history: history.docs
      .map((doc) => parseEvent(doc.id, doc.data()))
      .filter((event): event is HrRateEvent => event !== null),
  };
}

export async function saveHrRateLines(lines: readonly HrRateLine[]): Promise<{ error?: string }> {
  const gated = await requireMutationAuth("payroll.manage");
  if ("error" in gated) return { error: gated.error };
  const db = await staffDb();
  if (!db) return { error: "not_configured" };
  const clean = lines.map(parseLine).filter((line): line is HrRateLine => line !== null);
  const session = gated.session;
  const actor = session.profile.full_name?.trim() || session.email || session.id;
  const previousSnap = await db.collection(CATALOG).doc("catalog").get();
  const previousRaw = previousSnap.data()?.lines;
  const previous = Array.isArray(previousRaw)
    ? previousRaw.map(parseLine).filter((line): line is HrRateLine => line !== null)
    : [];
  const before = expandHrRateLines(previous);
  const after = expandHrRateLines(clean);
  const at = new Date().toISOString();
  const events: DocumentData[] = [];
  for (const [key, next] of after) {
    const prior = before.get(key);
    if (!prior) {
      events.push({ at, by: actor, item: next.item, field: "Rate added", from: "—", to: next.rate.toFixed(3) });
      continue;
    }
    if (prior.rate !== next.rate) {
      events.push({
        at,
        by: actor,
        item: next.item,
        field: "Rate",
        from: prior.rate.toFixed(3),
        to: next.rate.toFixed(3),
      });
    }
  }
  for (const [key, prior] of before) {
    if (!after.has(key)) {
      events.push({ at, by: actor, item: prior.item, field: "Rate removed", from: prior.rate.toFixed(3), to: "—" });
    }
  }
  const batch = db.batch();
  batch.set(db.collection(CATALOG).doc("catalog"), {
    lines: clean,
    updated_at: at,
    updated_by: actor,
  });
  for (const event of events) batch.set(db.collection(HISTORY).doc(), event);
  await batch.commit();
  return {};
}
