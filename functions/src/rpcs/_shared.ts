/**
 * Shared argument parsing and batched-write helpers for the admin RPCs.
 *
 * Every callable accepts both the camelCase spelling the panel sends and the
 * `p_snake_case` spelling the SQL RPCs used, because the panel and the driver
 * app were written against different wire shapes. Parsing lives here rather than
 * in each module so a new callable cannot invent a third spelling.
 */
import { HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
} from "../core/fs";
import { COLLECTIONS } from "../core/collections";

/** Firestore caps a batched write at 500 operations. */
export const BATCH_LIMIT = 400;
/** Firestore caps an `in` filter at 30 values. */
export const IN_FILTER_LIMIT = 30;
/** A scan ceiling for sweeps that are not paged. */
export const SCAN_CAP = 2000;

export type Dict = Record<string, unknown>;

/** First non-empty candidate. `0` and `false` are values, not absences. */
export function pick(data: Dict, ...names: string[]): unknown {
  for (const name of names) {
    const value = data[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function pickText(data: Dict, ...names: string[]): string | null {
  return textOrNull(pick(data, ...names));
}

export function pickId(data: Dict, ...names: string[]): string | null {
  return pickText(data, ...names);
}

export function pickIdList(data: Dict, ...names: string[]): string[] | null {
  const value = pick(data, ...names);
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export function pickNumber(data: Dict, fallback: number, ...names: string[]): number {
  const value = pick(data, ...names);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function pickCount(data: Dict, fallback: number, ...names: string[]): number {
  return Math.trunc(pickNumber(data, fallback, ...names));
}

export function pickBoolean(data: Dict, ...names: string[]): boolean {
  for (const name of names) {
    const value = data[name];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return false;
}

/** Tri-state boolean: `undefined` means "the caller expressed no opinion". */
export function pickTriBool(data: Dict, ...names: string[]): boolean | undefined {
  for (const name of names) {
    const value = data[name];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

export function pickInstant(data: Dict, ...names: string[]): Date | null {
  const value = pick(data, ...names);
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** `YYYY-MM-DD`, taken from a string date or a timestamp alike. */
export function pickDay(data: Dict, ...names: string[]): string | null {
  const value = pick(data, ...names);
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match ? match[1] : null;
  }
  const instant = pickInstant(data, ...names);
  return instant ? instant.toISOString().slice(0, 10) : null;
}

export function pickObject(data: Dict, ...names: string[]): Dict | null {
  const value = pick(data, ...names);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function requireUid(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "not_authenticated");
  return uid;
}

export function isoTimestamp(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim() !== "") return value;
  return null;
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A `Map<id, data>` for the documents that actually exist. */
export async function loadDocMap(
  collection: string,
  ids: readonly string[],
): Promise<Map<string, Dict>> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))];
  const out = new Map<string, Dict>();
  if (unique.length === 0) return out;
  const db = getFirestore();
  for (const group of chunk(unique, 300)) {
    const snaps = await db.getAll(
      ...group.map((id) => db.collection(collection).doc(id)),
    );
    for (const snap of snaps) {
      if (snap.exists) out.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  }
  return out;
}

export function dataOf(snapshot: DocumentSnapshot): Dict {
  return (snapshot.data() ?? {}) as Dict;
}

/**
 * The Firestore form of `admin_activity_logs`: an append-only row naming the
 * actor, the action and the record it touched.
 */
export async function logAdminActivity(args: {
  actorId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: Dict | null;
}): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTIONS.adminActivityLogs).add({
    actor_id: args.actorId,
    action: args.action,
    entity: args.entity,
    entity_id: args.entityId ?? null,
    detail: args.detail ?? null,
    created_at: FieldValue.serverTimestamp(),
  });
}

/** The Firestore form of `log_driver_operation`. */
export async function logDriverOperation(args: {
  driverId: string;
  module: string;
  action: string;
  actor: string;
  success?: boolean;
  recordType?: string | null;
  recordId?: string | null;
  detail?: Dict | null;
}): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTIONS.driverOperationEvents).add({
    driver_id: args.driverId,
    module: args.module,
    action: args.action,
    source: "rpc",
    actor: args.actor,
    success: args.success ?? true,
    record_type: args.recordType ?? null,
    record_id: args.recordId ?? null,
    detail: args.detail ?? null,
    occurred_at: FieldValue.serverTimestamp(),
  });
}
