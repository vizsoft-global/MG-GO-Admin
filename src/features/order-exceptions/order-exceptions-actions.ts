"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { callAdminFunction } from "@/lib/firebase/callable";
import { staffDb } from "@/lib/firebase/staff-db";
import { resolveOrderProofUrl } from "@/lib/storage/order-proof-resolve";
import { isHttpUrl } from "@/lib/storage/order-proof-url";
import {
  ORDER_EXCEPTION_EXPORT_MAX_ROWS,
  ORDER_EXCEPTION_MAX_PROOF_KEYS,
  ORDER_EXCEPTION_PAGE_SIZE,
  isOrderExceptionKind,
  isOrderExceptionSource,
  isOrderExceptionStatus,
  type OrderExceptionActionResult,
  type OrderExceptionCounts,
  type OrderExceptionDateRange,
  type OrderExceptionErrorCode,
  type OrderExceptionExportResult,
  type OrderExceptionListFilters,
  type OrderExceptionListResult,
  type OrderExceptionProof,
  type OrderExceptionRow,
  type OrderExceptionSummary,
  type ReviewOrderExceptionInput,
  type ReviewOrderExceptionResult,
} from "./types";

const READ_PERMISSION = "deliveries.view" as const;
const MANAGE_PERMISSION = "deliveries.manage" as const;
const ROUTE_NAME = "order-exceptions" as const;
const ORDER_EXCEPTION_COLLECTION = "order_exceptions" as const;
const MAX_LIMIT = 200;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function countOrZero(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function ymdOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function proofKeysOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value
    .map((entry) => textOrNull(entry))
    .filter((key): key is string => Boolean(key));
  return Array.from(new Set(keys));
}

type ParsedRow = Omit<OrderExceptionRow, "proofs" | "proof_count">;

/** Parse one callable row, keeping its proof keys out of the returned object. */
function parseRow(raw: unknown): { row: ParsedRow; proofKeys: string[] } {
  const row = asRecord(raw);
  return {
    row: {
      id: textOrNull(row.id) ?? "",
      created_at: textOrNull(row.created_at),
      updated_at: textOrNull(row.updated_at),
      day: textOrNull(row.day),
      driver_id: textOrNull(row.driver_id),
      driver_code: textOrNull(row.driver_code),
      driver_name: textOrNull(row.driver_name),
      kind: isOrderExceptionKind(row.kind) ? row.kind : "rejected",
      source: isOrderExceptionSource(row.source) ? row.source : "store_or_customer",
      status: isOrderExceptionStatus(row.status) ? row.status : "pending",
      order_id: textOrNull(row.order_id),
      delivery_id: textOrNull(row.delivery_id),
      restaurant_id: textOrNull(row.restaurant_id),
      restaurant_name: textOrNull(row.restaurant_name),
      reason: textOrNull(row.reason),
      reviewed_at: textOrNull(row.reviewed_at),
      reviewed_by: textOrNull(row.reviewed_by),
      reviewed_by_name: textOrNull(row.reviewed_by_name),
      review_note: textOrNull(row.review_note),
      counted_as_exception: row.counted_as_exception === true,
    },
    proofKeys: proofKeysOf(row.proof_keys),
  };
}

/**
 * Sign a row's proof keys. A key that cannot be signed is dropped rather than failing
 * the row — the reviewer still needs the reason, the order and the decision buttons.
 */
async function signProofs(keys: string[]): Promise<OrderExceptionProof[]> {
  const unique = keys.slice(0, ORDER_EXCEPTION_MAX_PROOF_KEYS);
  const signed = await Promise.all(
    unique.map(async (key): Promise<OrderExceptionProof | null> => {
      try {
        const proof = await resolveOrderProofUrl(key);
        if (!proof?.url) return null;
        return {
          key,
          url: proof.url,
          isImage: (proof.contentType ?? "").startsWith("image/"),
          isLink: isHttpUrl(key),
        };
      } catch {
        return null;
      }
    }),
  );
  return signed.filter((proof): proof is OrderExceptionProof => proof !== null);
}

async function toWireRow({ row, proofKeys }: { row: ParsedRow; proofKeys: string[] }) {
  return {
    ...row,
    proof_count: proofKeys.length,
    proofs: await signProofs(proofKeys),
  } satisfies OrderExceptionRow;
}

function normalizeCounts(value: unknown): OrderExceptionCounts {
  const counts = asRecord(value);
  return {
    pending: countOrZero(counts.pending),
    approved: countOrZero(counts.approved),
    rejected: countOrZero(counts.rejected),
    total: countOrZero(counts.total),
  };
}

function mapListError(message: string | undefined): OrderExceptionErrorCode {
  const code = (message ?? "").trim().toLowerCase();
  if (
    code === "not_authorized" ||
    code === "permission_denied" ||
    code === "unauthenticated" ||
    code === "not_authenticated" ||
    code === "staff_required"
  ) {
    return "not_authorized";
  }
  if (code === "not_configured") return "not_configured";
  return "unknown";
}

function mapReviewError(message: string | undefined): OrderExceptionErrorCode {
  const code = (message ?? "").trim().toLowerCase();
  if (code.includes("review_note_required")) return "review_note_required";
  if (code.includes("invalid_argument") || code.includes("invalid_input")) return "invalid_input";
  if (code.includes("already_reviewed")) return "invalid_input";
  return mapListError(message);
}

async function readAllowed(): Promise<boolean> {
  const session = await getSessionUser();
  if (!session) return false;
  return hasPermissionInSet(session.permissions, READ_PERMISSION, session.isSuperAdmin);
}

/**
 * One place that turns filters into the callable payload, so the queue and the
 * export cannot ask the server two different questions from one set of controls.
 */
function buildListPayload(
  filters: OrderExceptionListFilters,
  limit: number,
  offset: number,
): {
  payload: Record<string, unknown>;
  from?: string;
  to?: string;
  search: string | null;
} {
  const payload: Record<string, unknown> = { limit, offset };
  if (filters?.status && filters.status !== "all") payload.status = filters.status;
  if (filters?.kind && filters.kind !== "all") payload.kind = filters.kind;
  if (filters?.source && filters.source !== "all") payload.source = filters.source;

  const driverId = textOrNull(filters?.driverId);
  if (driverId) payload.driverId = driverId;

  const from = ymdOrUndefined(filters?.from);
  if (from) payload.from = from;
  const to = ymdOrUndefined(filters?.to);
  if (to) payload.to = to;

  const search = textOrNull(filters?.search);
  if (search) payload.search = search.slice(0, 120);
  const cursor = textOrNull(filters?.cursor);
  if (cursor) payload.cursor = cursor;

  return { payload, from, to, search };
}

/** Rows for the review queue. Proof keys are stripped from the wire shape. */
export async function listOrderExceptions(
  filters: OrderExceptionListFilters,
): Promise<OrderExceptionActionResult<OrderExceptionListResult>> {
  if (!(await readAllowed())) return { data: null, error: "not_authorized" };

  const requestedLimit = Math.floor(Number(filters?.limit ?? ORDER_EXCEPTION_PAGE_SIZE));
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : ORDER_EXCEPTION_PAGE_SIZE;
  const requestedOffset = Math.floor(Number(filters?.offset ?? 0));
  const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

  const { payload, from, to, search } = buildListPayload(filters, limit, offset);

  const { data, error } = await callAdminFunction<unknown>("adminListOrderExceptions", payload);
  if (error) return { data: null, error: mapListError(error.message) };

  const body = asRecord(data);
  const parsed = Array.isArray(body.rows) ? body.rows.map(parseRow) : [];
  const rows = await Promise.all(parsed.map(toWireRow));
  const counts = normalizeCounts(body.counts);
  const total = countOrZero(body.total) || counts.total || rows.length;

  await logAdminRead("order_exceptions", `${ROUTE_NAME}.list`, {
    status: filters?.status ?? "all",
    kind: filters?.kind ?? "all",
    source: filters?.source ?? "all",
    from: from ?? null,
    to: to ?? null,
    hasSearch: Boolean(search),
    offset,
  });

  return {
    data: {
      rows,
      total,
      counts,
      offset: Number.isFinite(Number(body.offset)) ? Math.max(Number(body.offset), 0) : offset,
      limit: Number.isFinite(Number(body.limit)) ? Math.max(Number(body.limit), 1) : limit,
      nextCursor: typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null,
    },
    error: null,
  };
}

/**
 * Every row matching the current filters, for the Excel export.
 *
 * The queue is paged at 50, but a spreadsheet has to carry the whole answer, so
 * this asks the callable for its widest window and reports the match count back:
 * the sheet stamps "exported N of M" rather than looking complete when it is not.
 * Proofs are deliberately not signed here — a 1,000-row sheet of signed URLs
 * would be both slow and useless in an offline file.
 */
export async function exportOrderExceptions(
  filters: OrderExceptionListFilters,
): Promise<OrderExceptionActionResult<OrderExceptionExportResult>> {
  if (!(await readAllowed())) return { data: null, error: "not_authorized" };

  const { payload, from, to, search } = buildListPayload(
    filters,
    0,
    0,
  );
  payload.limit = ORDER_EXCEPTION_EXPORT_MAX_ROWS;
  payload.offset = 0;
  payload.export = true;

  const { data, error } = await callAdminFunction<unknown>("adminListOrderExceptions", payload);
  if (error) return { data: null, error: mapListError(error.message) };

  const body = asRecord(data);
  const parsed = Array.isArray(body.rows) ? body.rows.map(parseRow) : [];
  const rows: OrderExceptionRow[] = parsed.map(({ row, proofKeys }) => ({
    ...row,
    proof_count: proofKeys.length,
    proofs: [],
  }));
  const matched = Math.max(countOrZero(body.total), rows.length);

  await logAdminRead("order_exceptions", `${ROUTE_NAME}.export`, {
    status: filters?.status ?? "all",
    kind: filters?.kind ?? "all",
    source: filters?.source ?? "all",
    from: from ?? null,
    to: to ?? null,
    hasSearch: Boolean(search),
    exported: rows.length,
    matched,
  });

  return {
    data: {
      rows,
      matched,
      capped: matched > rows.length,
      limit: ORDER_EXCEPTION_EXPORT_MAX_ROWS,
    },
    error: null,
  };
}

/** KPI strip totals for the same window the list is showing. */
export async function getOrderExceptionSummary(
  range?: OrderExceptionDateRange,
): Promise<OrderExceptionActionResult<OrderExceptionSummary>> {
  if (!(await readAllowed())) return { data: null, error: "not_authorized" };

  const payload: Record<string, unknown> = {};
  const from = ymdOrUndefined(range?.from);
  if (from) payload.from = from;
  const to = ymdOrUndefined(range?.to);
  if (to) payload.to = to;

  const { data, error } = await callAdminFunction<unknown>("adminOrderExceptionSummary", payload);
  if (error) return { data: null, error: mapListError(error.message) };

  const summary = asRecord(data);
  return {
    data: {
      pending: countOrZero(summary.pending),
      approved: countOrZero(summary.approved),
      rejected: countOrZero(summary.rejected),
      rejected_orders: countOrZero(summary.rejected_orders),
      cancelled_orders: countOrZero(summary.cancelled_orders),
      driver_declined: countOrZero(summary.driver_declined),
      store_or_customer: countOrZero(summary.store_or_customer),
      total: countOrZero(summary.total),
    },
    error: null,
  };
}

/** Verify or decline one exception. The server writes the audit row and notifies the rider. */
export async function reviewOrderException(
  input: ReviewOrderExceptionInput,
): Promise<OrderExceptionActionResult<ReviewOrderExceptionResult>> {
  const auth = await requireMutationAuth(MANAGE_PERMISSION);
  if ("error" in auth) {
    return { data: null, error: auth.error === "not_configured" ? "not_configured" : "not_authorized" };
  }

  const id = textOrNull(input?.id);
  if (!id) return { data: null, error: "invalid_input" };

  const decision = input?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return { data: null, error: "invalid_input" };
  }

  const note = textOrNull(input?.note);
  if (decision === "rejected" && !note) return { data: null, error: "review_note_required" };

  const payload: Record<string, unknown> = { id, decision };
  if (note) payload.note = note.slice(0, 1000);

  const { data, error } = await callAdminFunction<unknown>("adminReviewOrderException", payload);
  if (error) {
    const code = mapReviewError(error.message);
    await logAdminMutation({
      action: "update",
      entityType: "order_exceptions",
      entityId: id,
      routeName: `${ROUTE_NAME}.review`,
      context: { decision, error: error.message },
      success: false,
      errorMessage: error.message,
    });
    return { data: null, error: code };
  }

  const body = asRecord(data);
  const status = isOrderExceptionStatus(body.status) ? body.status : decision;

  await logAdminMutation({
    action: "update",
    entityType: "order_exceptions",
    entityId: id,
    routeName: `${ROUTE_NAME}.review`,
    after: {
      status,
      review_note: note,
      reviewed_by: auth.session.id,
      reviewed_at: new Date().toISOString(),
    },
    context: { decision, hasNote: Boolean(note) },
  });

  return { data: { ok: true, id: textOrNull(body.id) ?? id, status }, error: null };
}

/** Short-lived signed URLs for one exception's proof screenshots. Keys never leave the server. */
export async function resolveProofUrls(
  exceptionId: string,
): Promise<OrderExceptionActionResult<OrderExceptionProof[]>> {
  if (!(await readAllowed())) return { data: null, error: "not_authorized" };

  const id = textOrNull(exceptionId);
  if (!id) return { data: [], error: null };

  const db = await staffDb();
  if (!db) return { data: null, error: "not_configured" };

  const snap = await db.collection(ORDER_EXCEPTION_COLLECTION).doc(id).get();
  if (!snap.exists) return { data: [], error: null };

  const keys = proofKeysOf((snap.data() ?? {})["proof_keys"]);
  return { data: await signProofs(keys), error: null };
}
