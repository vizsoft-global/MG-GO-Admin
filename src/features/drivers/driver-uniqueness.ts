import "server-only";

import type { DocumentReference, Firestore, Query } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { UNIQ_COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

/** PostgREST-shaped error so `error.code` / `error.message` keep mapping. */
export class DbError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

export type StaffResult<T = any> = {
  data: T;
  error: DbError | null;
  count: number | null;
};

type CmpOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "ilike" | "like" | "is" | "in";

type OrNode =
  | { kind: "and"; parts: OrNode[] }
  | { kind: "cmp"; field: string; op: CmpOp; value: unknown };

type FieldFilter =
  | { kind: "eq"; field: string; value: unknown }
  | { kind: "neq"; field: string; value: unknown }
  | { kind: "in"; field: string; value: unknown[] }
  | { kind: "gt"; field: string; value: unknown }
  | { kind: "gte"; field: string; value: unknown }
  | { kind: "lt"; field: string; value: unknown }
  | { kind: "lte"; field: string; value: unknown }
  | { kind: "ilike"; field: string; value: string }
  | { kind: "like"; field: string; value: string }
  | { kind: "isnull"; field: string }
  | { kind: "notnull"; field: string }
  | { kind: "or"; parts: OrNode[] };

type QueryMode = "list" | "one";

type QueryPayload<M extends QueryMode> = {
  data: M extends "one" ? any : any[] | null;
  error: DbError | null;
  count: number | null;
};

type EmbedSpec = { key: string; fields: string[] };

type OrderSpec = { field: string; ascending: boolean; nullsFirst: boolean };

type QueryKind = "select" | "insert" | "upsert" | "update" | "delete" | "rpc";

type Snap = { id: string; data: Record<string, unknown> };

const IN_CHUNK = 30;
const GET_ALL_CHUNK = 10;

const COMPOSITE_ID: Record<string, readonly [string, string]> = {
  driver_restaurants: ["driver_id", "restaurant_id"],
  driver_intake_restaurants: ["intake_id", "restaurant_id"],
  driver_group_members: ["group_id", "driver_id"],
  driver_off_structure: ["driver_id", "period_month"],
};

const EMBED_FK: Record<string, { field: string; collection: string; self?: boolean }> = {
  profiles: { field: "id", collection: "profiles", self: true },
  partners: { field: "partner_id", collection: "partners" },
  zones: { field: "zone_id", collection: "zones" },
  restaurants: { field: "restaurant_id", collection: "restaurants" },
  driver_groups: { field: "group_id", collection: "driver_groups" },
};

const INSERT_STAMPS: Record<string, readonly string[]> = {
  driver_change_events: ["created_at"],
  driver_assignment_events: ["created_at"],
  driver_import_batches: ["uploaded_at"],
  driver_groups: ["created_at", "updated_at"],
  custom_field_definitions: ["created_at", "updated_at"],
  driver_intakes: ["created_at", "updated_at"],
  driver_login_verifications: ["created_at"],
};

const UPDATE_TOUCH = new Set(["driver_groups", "custom_field_definitions", "driver_intakes"]);

const LOCKS: Record<string, ReadonlyArray<{ field: string; collection: string; label: string; lower?: boolean }>> = {
  driver_intakes: [
    { field: "employee_id", collection: UNIQ_COLLECTIONS.employeeId, label: "employee_id", lower: true },
    { field: "phone", collection: UNIQ_COLLECTIONS.phone, label: "phone" },
    { field: "civil_id", collection: UNIQ_COLLECTIONS.civilId, label: "civil_id" },
  ],
  drivers: [
    { field: "employee_id", collection: UNIQ_COLLECTIONS.employeeId, label: "employee_id", lower: true },
    { field: "phone", collection: UNIQ_COLLECTIONS.phone, label: "phone" },
    { field: "civil_id", collection: UNIQ_COLLECTIONS.civilId, label: "civil_id" },
  ],
  profiles: [{ field: "phone", collection: UNIQ_COLLECTIONS.phone, label: "phone" }],
};

function fail(error: DbError): StaffResult<null> {
  return { data: null, error, count: null };
}

function ok<T>(data: T, count: number | null = null): StaffResult<T> {
  return { data, error: null, count };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === 9 || code === "failed-precondition" || /index|FAILED_PRECONDITION/i.test(message);
}

function timeOf(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function same(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const left = timeOf(a);
  const right = timeOf(b);
  if (left != null && right != null) return left === right;
  return a === b;
}

function compareValues(a: unknown, b: unknown): number {
  const left = timeOf(a);
  const right = timeOf(b);
  if (left != null && right != null) return left - right;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likeMatch(hay: unknown, pattern: string, flags: string): boolean {
  const source = pattern.split("%").map(escapeReg).join(".*");
  return new RegExp(`^${source}$`, flags).test(String(hay ?? ""));
}

function cmpOp(fieldVal: unknown, op: "gt" | "gte" | "lt" | "lte" | CmpOp, target: unknown): boolean {
  if (fieldVal == null || target == null) return false;
  const cmp = compareValues(fieldVal, target);
  switch (op) {
    case "gt":
      return cmp > 0;
    case "gte":
      return cmp >= 0;
    case "lt":
      return cmp < 0;
    case "lte":
      return cmp <= 0;
    default:
      return false;
  }
}

function splitTop(input: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")") depth -= 1;
    else if (!quoted && depth === 0 && char === ",") {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += char;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function parseCmp(part: string): OrNode {
  const dot1 = part.indexOf(".");
  const field = dot1 === -1 ? part : part.slice(0, dot1);
  const rest = dot1 === -1 ? "" : part.slice(dot1 + 1);
  const dot2 = rest.indexOf(".");
  const opRaw = dot2 === -1 ? rest : rest.slice(0, dot2);
  let raw = dot2 === -1 ? "" : rest.slice(dot2 + 1);
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  const op = opRaw as CmpOp;
  switch (op) {
    case "is":
      return { kind: "cmp", field, op, value: raw === "null" ? null : raw };
    case "in": {
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
      const value = inner.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter(Boolean);
      return { kind: "cmp", field, op, value };
    }
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "ilike":
    case "like":
      return { kind: "cmp", field, op, value: raw };
    default: {
      const unexpected: never = op;
      void unexpected;
      return { kind: "cmp", field, op: "eq", value: raw };
    }
  }
}

function parseOr(input: string): OrNode[] {
  return splitTop(input).map((part) => {
    if (part.startsWith("and(") && part.endsWith(")")) {
      return { kind: "and" as const, parts: splitTop(part.slice(4, -1)).map(parseCmp) };
    }
    return parseCmp(part);
  });
}

function matchCmp(row: Record<string, unknown>, node: Extract<OrNode, { kind: "cmp" }>): boolean {
  const fieldVal = row[node.field];
  switch (node.op) {
    case "eq":
      return same(fieldVal, node.value);
    case "neq":
      return !same(fieldVal, node.value);
    case "is":
      return node.value == null ? fieldVal == null : same(fieldVal, node.value);
    case "in":
      return Array.isArray(node.value) && node.value.some((item) => same(fieldVal, item));
    case "ilike":
      return likeMatch(fieldVal, String(node.value), "i");
    case "like":
      return likeMatch(fieldVal, String(node.value), "");
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return cmpOp(fieldVal, node.op, node.value);
    default: {
      const unexpected: never = node.op;
      void unexpected;
      return false;
    }
  }
}

function matchOr(row: Record<string, unknown>, node: OrNode): boolean {
  switch (node.kind) {
    case "and":
      return node.parts.every((part) => matchOr(row, part));
    case "cmp":
      return matchCmp(row, node);
    default: {
      const unexpected: never = node;
      void unexpected;
      return false;
    }
  }
}

function matches(row: Record<string, unknown>, filter: FieldFilter): boolean {
  switch (filter.kind) {
    case "eq":
      return same(row[filter.field], filter.value);
    case "neq":
      return !same(row[filter.field], filter.value);
    case "in":
      return filter.value.some((item) => same(row[filter.field], item));
    case "isnull":
      return row[filter.field] == null;
    case "notnull":
      return row[filter.field] != null;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return cmpOp(row[filter.field], filter.kind, filter.value);
    case "ilike":
      return likeMatch(row[filter.field], filter.value, "i");
    case "like":
      return likeMatch(row[filter.field], filter.value, "");
    case "or":
      return filter.parts.some((part) => matchOr(row, part));
    default: {
      const unexpected: never = filter;
      void unexpected;
      return false;
    }
  }
}

function asRead(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(asRead);
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = asRead(inner);
    return out;
  }
  return value;
}

function asReadRecord(value: Record<string, unknown>): Record<string, unknown> {
  return asRead(value) as Record<string, unknown>;
}

function asWrite(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (Array.isArray(value)) return value.map(asWrite);
  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof Timestamp)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (inner !== undefined) out[key] = asWrite(inner);
    }
    return out;
  }
  return value;
}

function asWriteRecord(value: Record<string, unknown>): Record<string, unknown> {
  const written = asWrite(value);
  return written && typeof written === "object" && !Array.isArray(written)
    ? (written as Record<string, unknown>)
    : {};
}

function coerceQuery(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return value;
}

function parseSelect(raw: string | undefined): { columns: "*" | string[]; embeds: EmbedSpec[] } {
  if (!raw || raw.trim() === "" || raw.trim() === "*") return { columns: "*", embeds: [] };
  const columns: string[] = [];
  const embeds: EmbedSpec[] = [];
  let star = false;
  for (const part of splitTop(raw)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z0-9_]+)?\s*\(([\s\S]*)\)$/.exec(part);
    if (match) {
      embeds.push({
        key: match[1]!,
        fields: splitTop(match[2]!).map((field) => field.trim()).filter(Boolean),
      });
      continue;
    }
    if (part === "*") star = true;
    else columns.push(part);
  }
  return { columns: star || columns.length === 0 ? "*" : columns, embeds };
}

function pick(row: Record<string, unknown>, fields: "*" | string[]): Record<string, unknown> {
  if (fields === "*") return { ...row, id: row.id };
  const out: Record<string, unknown> = { id: row.id };
  for (const field of fields) out[field] = row[field];
  return out;
}

function docIdFor(table: string, row: Record<string, unknown>): string {
  if (typeof row.id === "string" && row.id) return row.id;
  const composite = COMPOSITE_ID[table];
  if (composite) {
    const left = row[composite[0]];
    const right = row[composite[1]];
    if (left != null && left !== "" && right != null && right !== "") return `${left}_${right}`;
  }
  if (table === "source_companies" && row.key != null && row.key !== "") return String(row.key);
  return crypto.randomUUID();
}

function lockValue(raw: unknown, lower?: boolean): string {
  if (raw == null) return "";
  const text = String(raw).trim();
  if (!text) return "";
  return lower ? text.toLowerCase() : text;
}

function duplicate(label: string): DbError {
  return new DbError(`duplicate key value violates unique constraint ${label}`, "23505");
}

async function readDocs(db: Firestore, refs: DocumentReference[]): Promise<Snap[]> {
  if (refs.length === 0) return [];
  const groups = chunk(refs, GET_ALL_CHUNK);
  const snaps: Snap[] = [];
  for (const group of chunk(groups, 8)) {
    const results = await Promise.all(group.map((part) => db.getAll(...part)));
    for (const part of results) {
      for (const snap of part) {
        if (snap.exists) snaps.push({ id: snap.id, data: (snap.data() ?? {}) as Record<string, unknown> });
      }
    }
  }
  return snaps;
}

function rowFromSnap(snap: Snap): Record<string, unknown> {
  return asReadRecord({ id: snap.id, ...snap.data });
}

async function attachEmbeds(
  db: Firestore,
  rows: Record<string, unknown>[],
  embeds: EmbedSpec[],
): Promise<Record<string, unknown>[]> {
  const out = rows.map((row) => ({ ...row }));
  for (const embed of embeds) {
    const spec = EMBED_FK[embed.key];
    if (!spec) {
      for (const row of out) row[embed.key] = null;
      continue;
    }
    const ids = [
      ...new Set(
        out
          .map((row) => (spec.self ? row.id : row[spec.field]))
          .filter((id) => id != null && id !== "")
          .map(String),
      ),
    ];
    const docs = await readDocs(db, ids.map((id) => db.collection(spec.collection).doc(id)));
    const byId = new Map(
      docs.map((doc) => [doc.id, pick(asReadRecord({ id: doc.id, ...doc.data }), embed.fields.length ? embed.fields : "*")]),
    );
    for (const row of out) {
      const id = spec.self ? String(row.id ?? "") : row[spec.field] == null ? "" : String(row[spec.field]);
      row[embed.key] = id ? (byId.get(id) ?? null) : null;
    }
  }
  return out;
}

type RangeFilter = Extract<FieldFilter, { kind: "gt" | "gte" | "lt" | "lte" }>;

function rangeOp(kind: RangeFilter["kind"]): FirebaseFirestore.WhereFilterOp {
  switch (kind) {
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    default: {
      const unexpected: never = kind;
      void unexpected;
      return "==";
    }
  }
}

async function execQuery(
  col: FirebaseFirestore.CollectionReference,
  eqs: Extract<FieldFilter, { kind: "eq" }>[],
  inFilter: Extract<FieldFilter, { kind: "in" }> | null,
  inValues: unknown[] | null,
  ranges: RangeFilter[],
  rangeField: string | null,
): Promise<Snap[]> {
  let query: Query = col;
  for (const eq of eqs) query = query.where(eq.field, "==", coerceQuery(eq.value));
  if (inFilter && inValues) query = query.where(inFilter.field, "in", inValues.map(coerceQuery));
  if (rangeField) {
    for (const range of ranges) {
      if (range.field === rangeField) query = query.where(range.field, rangeOp(range.kind), coerceQuery(range.value));
    }
    query = query.orderBy(rangeField);
  }
  const got = await query.get();
  return got.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> }));
}

async function queryCollection(db: Firestore, table: string, filters: FieldFilter[]): Promise<Snap[]> {
  const idEq = filters.find((filter) => filter.kind === "eq" && filter.field === "id");
  const idIn = filters.find((filter) => filter.kind === "in" && filter.field === "id");
  if (idEq || idIn) {
    const ids = idEq
      ? [String((idEq as Extract<FieldFilter, { kind: "eq" }>).value)]
      : ((idIn as Extract<FieldFilter, { kind: "in" }>).value).map(String);
    if (ids.length === 0 || ids.some((id) => !id)) return [];
    return readDocs(db, ids.filter(Boolean).map((id) => db.collection(table).doc(id)));
  }

  const driverBound = filters.some(
    (filter) =>
      (filter.kind === "eq" || filter.kind === "in") &&
      (filter.field === "driver_id" || filter.field === "id"),
  );
  if (table === "deliveries" && !driverBound) {
    throw new DbError("query_index_required");
  }

  const eqs = filters.filter((filter): filter is Extract<FieldFilter, { kind: "eq" }> => filter.kind === "eq" && filter.value != null);
  const ins = filters.filter(
    (filter): filter is Extract<FieldFilter, { kind: "in" }> => filter.kind === "in" && filter.value.length > 0,
  );
  const ranges = filters.filter((filter): filter is RangeFilter =>
    filter.kind === "gt" || filter.kind === "gte" || filter.kind === "lt" || filter.kind === "lte",
  );
  const rangeFields = [...new Set(ranges.map((range) => range.field))];
  const rangeField = rangeFields.length === 1 ? rangeFields[0]! : null;
  const pushedRanges = rangeField ? ranges.filter((range) => range.field === rangeField) : [];
  const inFilter = ins[0] ?? null;
  const groups = inFilter ? chunk(inFilter.value, IN_CHUNK) : [null];
  const col = db.collection(table);
  const snaps: Snap[] = [];

  for (const ids of groups) {
    try {
      snaps.push(...(await execQuery(col, eqs, inFilter, ids, pushedRanges, rangeField)));
      continue;
    } catch (error) {
      if (!isIndexError(error)) throw error;
    }
    if (rangeField && inFilter && ids) {
      try {
        for (const id of ids) {
          snaps.push(
            ...(await execQuery(
              col,
              [...eqs, { kind: "eq", field: inFilter.field, value: id }],
              null,
              null,
              pushedRanges,
              rangeField,
            )),
          );
        }
        continue;
      } catch (error) {
        if (!isIndexError(error)) throw error;
        if (table === "deliveries") throw new DbError("query_index_required");
      }
    }
    if (table === "deliveries" && rangeField) throw new DbError("query_index_required");
    snaps.push(...(await execQuery(col, eqs, inFilter, ids, [], null)));
  }
  return snaps;
}

async function relatedOwners(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  selfId: string,
  ownerId: string,
  cache: Map<string, string | null>,
): Promise<boolean> {
  if (selfId === ownerId) return true;
  const ids = [selfId, ownerId].filter((id) => !cache.has(id));
  if (ids.length > 0) {
    const snaps = await Promise.all(ids.map((id) => tx.get(db.collection("driver_intakes").doc(id))));
    for (const snap of snaps) {
      const linked = snap.data()?.linked_profile_id;
      cache.set(snap.id, typeof linked === "string" ? linked : null);
    }
  }
  return cache.get(selfId) === ownerId || cache.get(ownerId) === selfId;
}

async function writeLocked(
  db: Firestore,
  table: string,
  id: string,
  data: Record<string, unknown>,
  mode: "insert" | "merge",
): Promise<void> {
  const locks = LOCKS[table] ?? [];
  const ref = db.collection(table).doc(id);
  if (locks.length === 0) {
    if (mode === "insert") {
      const existing = await ref.get();
      if (existing.exists) throw duplicate(table);
      await ref.set(data);
      return;
    }
    await ref.set(data, { merge: true });
    return;
  }

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (mode === "insert" && existing.exists) throw duplicate(table);
    const base = existing.exists ? ((existing.data() ?? {}) as Record<string, unknown>) : {};
    const merged = { ...base, ...data };
    const archived = merged.archived_at != null && merged.archived_at !== "";
    type Plan = { type: "claim" | "release"; lock: (typeof locks)[number]; value: string };
    const plans: Plan[] = [];
    for (const lock of locks) {
      const next = lockValue(merged[lock.field], lock.lower);
      const prev = lockValue(base[lock.field], lock.lower);
      if (prev && prev !== next) plans.push({ type: "release", lock, value: prev });
      if (archived && prev) plans.push({ type: "release", lock, value: prev });
      if (!archived && next) plans.push({ type: "claim", lock, value: next });
    }
    const seen = new Set<string>();
    const unique = plans.filter((plan) => {
      const key = `${plan.type}:${plan.lock.collection}:${plan.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const lockRefs = unique.map((plan) =>
      db.collection(plan.lock.collection).doc(encodeURIComponent(plan.value)),
    );
    const lockSnaps = await Promise.all(lockRefs.map((lockRef) => tx.get(lockRef)));
    const cache = new Map<string, string | null>();
    for (let i = 0; i < unique.length; i += 1) {
      const plan = unique[i]!;
      if (plan.type !== "claim") continue;
      const owner = lockSnaps[i]?.data()?.owner_id;
      if (typeof owner === "string" && !(await relatedOwners(tx, db, id, owner, cache))) {
        throw duplicate(plan.lock.label);
      }
    }
    for (let i = 0; i < unique.length; i += 1) {
      const plan = unique[i]!;
      const lockRef = lockRefs[i]!;
      const owner = lockSnaps[i]?.data()?.owner_id;
      if (plan.type === "release") {
        if (owner === id) tx.delete(lockRef);
      } else {
        tx.set(lockRef, { owner_id: id });
      }
    }
    tx.set(ref, data, { merge: mode === "merge" });
  });
}

async function releaseLocks(db: Firestore, table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const locks = LOCKS[table] ?? [];
  if (locks.length === 0) return;
  await db.runTransaction(async (tx) => {
    const plans = locks
      .map((lock) => ({ lock, value: lockValue(data[lock.field], lock.lower) }))
      .filter((plan) => plan.value);
    const refs = plans.map((plan) => db.collection(plan.lock.collection).doc(encodeURIComponent(plan.value)));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    for (let i = 0; i < plans.length; i += 1) {
      if (snaps[i]?.data()?.owner_id === id) tx.delete(refs[i]!);
    }
    tx.delete(db.collection(table).doc(id));
  });
}

function sortRows(rows: Record<string, unknown>[], orders: OrderSpec[]): Record<string, unknown>[] {
  if (orders.length === 0) return rows;
  return [...rows].sort((left, right) => {
    for (const order of orders) {
      const a = left[order.field];
      const b = right[order.field];
      const aNull = a == null;
      const bNull = b == null;
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        if (order.nullsFirst) return aNull ? -1 : 1;
        return aNull ? 1 : -1;
      }
      const cmp = compareValues(a, b);
      if (cmp !== 0) return order.ascending ? cmp : -cmp;
    }
    return 0;
  });
}

export class StaffQuery<M extends QueryMode = "list"> {
  private kind: QueryKind = "select";
  private filters: FieldFilter[] = [];
  private orders: OrderSpec[] = [];
  private limitN: number | null = null;
  private page: { from: number; to: number } | null = null;
  private mode: "many" | "one" | "maybe" = "many";
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private parsed = parseSelect("*");
  private returning = true;
  private wantCount = false;
  private head = false;
  private rpcName = "";
  private rpcArgs: Record<string, unknown> = {};
  private forcedError: DbError | null = null;

  constructor(
    private readonly db: Firestore | null,
    private readonly table: string,
  ) {}

  select(columns?: string, options?: { count?: "exact"; head?: boolean }): this {
    this.parsed = parseSelect(columns);
    this.returning = true;
    this.wantCount = options?.count === "exact";
    this.head = Boolean(options?.head);
    return this;
  }

  eq(field: string, value: unknown): this {
    this.filters.push({ kind: "eq", field, value });
    return this;
  }

  neq(field: string, value: unknown): this {
    this.filters.push({ kind: "neq", field, value });
    return this;
  }

  gt(field: string, value: unknown): this {
    this.filters.push({ kind: "gt", field, value });
    return this;
  }

  gte(field: string, value: unknown): this {
    this.filters.push({ kind: "gte", field, value });
    return this;
  }

  lt(field: string, value: unknown): this {
    this.filters.push({ kind: "lt", field, value });
    return this;
  }

  lte(field: string, value: unknown): this {
    this.filters.push({ kind: "lte", field, value });
    return this;
  }

  in(field: string, values: readonly unknown[]): this {
    this.filters.push({ kind: "in", field, value: [...values] });
    return this;
  }

  is(field: string, value: null): this {
    if (value == null) this.filters.push({ kind: "isnull", field });
    else this.filters.push({ kind: "eq", field, value });
    return this;
  }

  ilike(field: string, pattern: string): this {
    this.filters.push({ kind: "ilike", field, value: pattern });
    return this;
  }

  like(field: string, pattern: string): this {
    this.filters.push({ kind: "like", field, value: pattern });
    return this;
  }

  not(field: string, op: string, value: unknown): this {
    if (op === "is" && value == null) this.filters.push({ kind: "notnull", field });
    else this.filters.push({ kind: "neq", field, value });
    return this;
  }

  or(filters: string, _options?: unknown): this {
    this.filters.push({ kind: "or", parts: parseOr(filters) });
    return this;
  }

  filter(field: string, op: string, value: unknown): this {
    switch (op) {
      case "eq":
        return this.eq(field, value);
      case "neq":
        return this.neq(field, value);
      case "gt":
        return this.gt(field, value);
      case "gte":
        return this.gte(field, value);
      case "lt":
        return this.lt(field, value);
      case "lte":
        return this.lte(field, value);
      case "ilike":
        return this.ilike(field, String(value));
      case "like":
        return this.like(field, String(value));
      case "is":
        return this.is(field, null);
      case "in":
        return this.in(field, Array.isArray(value) ? value : [value]);
      default:
        this.forcedError = new DbError(`unsupported_filter:${op}`);
        return this;
    }
  }

  order(field: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const ascending = options?.ascending ?? true;
    this.orders.push({
      field,
      ascending,
      nullsFirst: options?.nullsFirst ?? !ascending,
    });
    return this;
  }

  limit(count: number): this {
    this.limitN = count;
    return this;
  }

  range(from: number, to: number): this {
    this.page = { from, to };
    return this;
  }

  maybeSingle(): StaffQuery<"one"> {
    this.mode = "maybe";
    return this as unknown as StaffQuery<"one">;
  }

  single(): StaffQuery<"one"> {
    this.mode = "one";
    return this as unknown as StaffQuery<"one">;
  }

  insert(row: Record<string, unknown> | Record<string, unknown>[]): this {
    this.kind = "insert";
    this.rows = Array.isArray(row) ? row : [row];
    this.returning = false;
    return this;
  }

  upsert(row: Record<string, unknown> | Record<string, unknown>[]): this {
    this.kind = "upsert";
    this.rows = Array.isArray(row) ? row : [row];
    this.returning = false;
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.kind = "update";
    this.patch = patch;
    this.returning = false;
    return this;
  }

  delete(): this {
    this.kind = "delete";
    this.returning = false;
    return this;
  }

  /** `db.rpc(name, args)` — the SQL name, not the camelCase export. */
  rpc(name: string, args?: Record<string, unknown>): StaffQuery<"one"> {
    this.kind = "rpc";
    this.rpcName = name;
    this.rpcArgs = args ?? {};
    return this as unknown as StaffQuery<"one">;
  }

  then<TResult1 = QueryPayload<M>, TResult2 = never>(
    onfulfilled?: ((value: QueryPayload<M>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<StaffResult> {
    if (this.forcedError) return fail(this.forcedError);
    try {
      return await this.execute();
    } catch (error) {
      if (error instanceof DbError) return fail(error);
      const message = error instanceof Error ? error.message : "save_failed";
      return fail(new DbError(message));
    }
  }

  private async execute(): Promise<StaffResult> {
    switch (this.kind) {
      case "rpc":
        return this.executeRpc();
      case "select":
        return this.executeSelect();
      case "insert":
        return this.executeInsert("insert");
      case "upsert":
        return this.executeInsert("merge");
      case "update":
        return this.executeUpdate();
      case "delete":
        return this.executeDelete();
      default: {
        const unexpected: never = this.kind;
        void unexpected;
        return fail(new DbError("unsupported"));
      }
    }
  }

  private async executeRpc(): Promise<StaffResult> {
    const result = await callAdminFunction(this.rpcName, this.rpcArgs);
    if (result.error) return fail(new DbError(result.error.message, result.error.code));
    return ok(result.data);
  }

  private requireDb(): Firestore {
    if (!this.db) throw new DbError("not_configured");
    return this.db;
  }

  private async loadRows(): Promise<Record<string, unknown>[]> {
    const db = this.requireDb();
    const emptyIn = this.filters.some((filter) => filter.kind === "in" && filter.value.length === 0);
    if (emptyIn) return [];
    const snaps = await queryCollection(db, this.table, this.filters);
    return snaps.map(rowFromSnap).filter((row) => this.filters.every((filter) => matches(row, filter)));
  }

  private async shapeRows(rows: Record<string, unknown>[]): Promise<StaffResult> {
    const sorted = sortRows(rows, this.orders);
    const total = sorted.length;
    let sliced = sorted;
    if (this.page) sliced = sorted.slice(this.page.from, this.page.to + 1);
    else if (this.limitN != null) sliced = sorted.slice(0, this.limitN);
    const count = this.wantCount ? total : null;
    if (this.head) return ok(null, count);
    const db = this.requireDb();
    const embedded = await attachEmbeds(db, sliced, this.parsed.embeds);
    const projected = embedded.map((row) => pick(row, this.parsed.columns));
    if (this.mode === "maybe") {
      if (projected.length > 1) {
        return fail(new DbError("JSON object requested, multiple (or no) rows returned", "PGRST116"));
      }
      return ok(projected[0] ?? null, count);
    }
    if (this.mode === "one") {
      if (projected.length !== 1) {
        return fail(new DbError("JSON object requested, multiple (or no) rows returned", "PGRST116"));
      }
      return ok(projected[0], count);
    }
    return ok(projected, count);
  }

  private async executeSelect(): Promise<StaffResult> {
    return this.shapeRows(await this.loadRows());
  }

  private prepare(row: Record<string, unknown>, isInsert: boolean): { id: string; data: Record<string, unknown> } {
    const data = asWriteRecord(row);
    if (isInsert) {
      const now = new Date();
      for (const field of INSERT_STAMPS[this.table] ?? []) {
        if (data[field] == null) data[field] = now;
      }
      if (this.table === "driver_groups" && data.member_count == null) data.member_count = 0;
    }
    const id = docIdFor(this.table, { ...row, ...data });
    data.id = id;
    return { id, data };
  }

  private async executeInsert(mode: "insert" | "merge"): Promise<StaffResult> {
    const db = this.requireDb();
    if (this.rows.length === 0) return this.returning ? ok([]) : ok(null);
    const prepared = this.rows.map((row) => this.prepare(row, mode === "insert"));
    if (mode === "insert") {
      const existing = await readDocs(db, prepared.map((row) => db.collection(this.table).doc(row.id)));
      if (existing.length > 0) return fail(duplicate(this.table));
    }
    for (const row of prepared) {
      await writeLocked(db, this.table, row.id, row.data, mode);
    }
    if (!this.returning) return ok(null);
    const written = prepared.map((row) => asReadRecord(row.data));
    return this.shapeRows(written);
  }

  private async executeUpdate(): Promise<StaffResult> {
    const db = this.requireDb();
    if (this.filters.length === 0) return fail(new DbError("missing_filter"));
    const snaps = await queryCollection(db, this.table, this.filters);
    const targets = snaps.map(rowFromSnap).filter((row) => this.filters.every((filter) => matches(row, filter)));
    const patch = asWriteRecord(this.patch);
    if (UPDATE_TOUCH.has(this.table) && patch.updated_at == null) patch.updated_at = new Date();
    for (const row of targets) {
      const id = String(row.id);
      await writeLocked(db, this.table, id, patch, "merge");
    }
    if (!this.returning) return ok(null);
    return this.shapeRows(targets.map((row) => asReadRecord({ ...row, ...asReadRecord(patch) })));
  }

  private async executeDelete(): Promise<StaffResult> {
    const db = this.requireDb();
    if (this.filters.length === 0) return fail(new DbError("missing_filter"));
    const snaps = await queryCollection(db, this.table, this.filters);
    const targets = snaps.map(rowFromSnap).filter((row) => this.filters.every((filter) => matches(row, filter)));
    if (LOCKS[this.table]) {
      for (const row of targets) await releaseLocks(db, this.table, String(row.id), row);
    } else {
      for (const group of chunk(targets, 400)) {
        const batch = db.batch();
        for (const row of group) batch.delete(db.collection(this.table).doc(String(row.id)));
        await batch.commit();
      }
    }
    if (!this.returning) return ok(null);
    return this.shapeRows(targets);
  }
}

export class StaffClient {
  constructor(private readonly db: Firestore | null) {}

  from(table: string): StaffQuery {
    return new StaffQuery(this.db, table);
  }

  rpc(name: string, args?: Record<string, unknown>): StaffQuery<"one"> {
    const query = new StaffQuery(this.db, "");
    return query.rpc(name, args);
  }
};

export async function staffClient(): Promise<StaffClient> {
  return new StaffClient(await staffDb());
}

/** Unwrap one `.in()` the way `fetchAllIn` did, chunking inside the query client. */
export async function fetchAllIn<T>(
  ids: readonly string[],
  load: (chunk: readonly string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const part = await load(ids);
  if (part.error) throw part.error;
  return part.data ?? [];
}

/** True when another non-archived intake or linked driver already uses this civil ID. */
export async function civilIdExists(civilId: string, excludeIntakeId?: string): Promise<boolean> {
  const db = await staffClient();
  let intakeQuery = db
    .from("driver_intakes")
    .select("id")
    .eq("civil_id", civilId)
    .is("archived_at", null)
    .limit(1);
  if (excludeIntakeId) intakeQuery = intakeQuery.neq("id", excludeIntakeId);
  const { data: intakeHit } = await intakeQuery.maybeSingle();
  if (intakeHit) return true;

  const { data: driverHits } = await db.from("drivers").select("id").eq("civil_id", civilId);
  if (!driverHits?.length) return false;
  if (!excludeIntakeId) return true;

  for (const driver of driverHits) {
    const { data: linkedIntake } = await db
      .from("driver_intakes")
      .select("id")
      .eq("linked_profile_id", driver.id)
      .maybeSingle();
    if (linkedIntake?.id !== excludeIntakeId) return true;
  }
  return false;
}

/** True when another non-archived intake or linked driver already uses this employee ID. */
export async function employeeIdExists(employeeId: string, excludeIntakeId?: string): Promise<boolean> {
  const db = await staffClient();
  let intakeQuery = db
    .from("driver_intakes")
    .select("id")
    .ilike("employee_id", employeeId)
    .is("archived_at", null)
    .limit(1);
  if (excludeIntakeId) intakeQuery = intakeQuery.neq("id", excludeIntakeId);
  const { data: intakeHit } = await intakeQuery.maybeSingle();
  if (intakeHit) return true;

  const { data: driverHits } = await db.from("drivers").select("id").ilike("employee_id", employeeId);
  if (!driverHits?.length) return false;
  if (!excludeIntakeId) return true;

  for (const driver of driverHits) {
    const { data: linkedIntake } = await db
      .from("driver_intakes")
      .select("id")
      .eq("linked_profile_id", driver.id)
      .maybeSingle();
    if (linkedIntake?.id !== excludeIntakeId) return true;
  }
  return false;
}
