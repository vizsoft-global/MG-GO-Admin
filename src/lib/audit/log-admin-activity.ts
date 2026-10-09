import { FieldValue } from "firebase-admin/firestore";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/get-session";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

const READ_THROTTLE_MS = 60_000;
/**
 * How far back a decide suppresses a following request Read. The pair is
 * seconds apart in practice; the window only has to cover a slow re-render.
 */
const REQUEST_READ_AFTER_UPDATE_MS = 120_000;
const readThrottle = new Map<string, number>();

function shouldThrottleRead(key: string): boolean {
  const now = Date.now();
  const last = readThrottle.get(key);
  if (last !== undefined && now - last < READ_THROTTLE_MS) return true;
  readThrottle.set(key, now);
  if (readThrottle.size > 500) {
    for (const [k, t] of readThrottle) {
      if (now - t > READ_THROTTLE_MS) readThrottle.delete(k);
    }
  }
  return false;
}

export type AdminActivityAction =
  | "create"
  | "update"
  | "delete"
  | "view"
  | "read"
  | "auth"
  | "export"
  | "recalculate";

export type LogAdminActivityInput = {
  action: AdminActivityAction;
  entityType?: string;
  entityId?: string;
  pagePath?: string;
  routeName?: string;
  success?: boolean;
  errorMessage?: string;
  context?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  adminUserId?: string;
  adminRoleSlug?: string;
};

function jsonSafe<T>(value: T): T {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function computeChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const b = JSON.stringify(before[key] ?? null);
    const a = JSON.stringify(after[key] ?? null);
    if (b !== a) changed.push(key);
  }
  return changed;
}

async function readRequestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ipAddress = forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip");
    const userAgent = h.get("user-agent");
    return { ipAddress, userAgent };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export async function logAdminActivity(input: LogAdminActivityInput): Promise<void> {
  try {
    const session = input.adminUserId
      ? null
      : await getSessionUser();
    const adminUserId = input.adminUserId ?? session?.id ?? null;
    const adminRoleSlug = input.adminRoleSlug ?? session?.adminRoleSlug ?? null;

    if (!adminUserId) return;

    const { ipAddress, userAgent } = await readRequestMeta();
    const changedFields = computeChangedFields(input.before, input.after);
    const db = await staffDb();
    if (!db) return;

    const id = crypto.randomUUID();
    await db.collection(COLLECTIONS.adminActivityLogs).doc(id).set({
      id,
      admin_user_id: adminUserId,
      admin_role_slug: adminRoleSlug,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      page_path: input.pagePath ?? null,
      route_name: input.routeName ?? null,
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
      context: jsonSafe(input.context ?? {}),
      before_state: jsonSafe(input.before ?? null),
      after_state: jsonSafe(input.after ?? null),
      changed_fields: changedFields,
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: FieldValue.serverTimestamp(),
    });
  } catch {
    /* best-effort audit — never block main action */
  }
}

export async function logAdminPageView(
  pagePath: string,
  routeName: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const key = `view:${routeName}:${pagePath}`;
  if (shouldThrottleRead(key)) return;
  await logAdminActivity({
    action: "view",
    pagePath,
    routeName,
    context,
  });
}

function adminReadThrottleKey(
  routeName: string,
  entityType: string,
  context?: Record<string, unknown>,
): string {
  const requestId = typeof context?.requestId === "string" ? context.requestId : "";
  return requestId
    ? `read:${routeName}:${entityType}:${requestId}`
    : `read:${routeName}:${entityType}`;
}

export async function logAdminRead(
  entityType: string,
  routeName: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const requestId = typeof context?.requestId === "string" ? context.requestId : "";
  const key = adminReadThrottleKey(routeName, entityType, context);
  if (shouldThrottleRead(key)) return;
  // The in-process throttle above cannot see a decide that ran in another
  // serverless invocation, so a re-render could still write a Read *after* the
  // Update it followed — which the audit list then shows below the decision it
  // preceded. An Update for this request by this admin in the last two minutes
  // means the open was already recorded, so the later Read is dropped.
  if (requestId && routeName === "requests.detail") {
    const session = await getSessionUser();
    if (session?.id) {
      try {
        const db = await staffDb();
        if (db) {
          const since = new Date(Date.now() - REQUEST_READ_AFTER_UPDATE_MS);
          const recent = await db
            .collection(COLLECTIONS.adminActivityLogs)
            .where("admin_user_id", "==", session.id)
            .where("entity_type", "==", "requests")
            .where("entity_id", "==", requestId)
            .where("action", "==", "update")
            .where("created_at", ">=", since)
            .limit(1)
            .get();
          if (!recent.empty) return;
        }
      } catch {
        // Missing index must not hide the read that would otherwise be written.
      }
    }
  }
  await logAdminActivity({
    action: "read",
    entityType,
    entityId: requestId || undefined,
    routeName,
    context,
  });
}

export async function logAdminMutation(input: {
  action: "create" | "update" | "delete" | "recalculate" | "export";
  entityType: string;
  entityId?: string;
  routeName: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  context?: Record<string, unknown>;
  success?: boolean;
  errorMessage?: string;
}): Promise<void> {
  await logAdminActivity({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    routeName: input.routeName,
    before: input.before,
    after: input.after,
    context: input.context,
    success: input.success,
    errorMessage: input.errorMessage,
  });
  if (
    input.success !== false &&
    input.entityType === "requests" &&
    input.entityId
  ) {
    readThrottle.set(`read:requests.detail:requests:${input.entityId}`, Date.now());
  }
}

export async function logAdminAuthEvent(input: {
  action: "auth";
  routeName: string;
  success: boolean;
  context?: Record<string, unknown>;
  errorMessage?: string;
  adminUserId?: string;
}): Promise<void> {
  await logAdminActivity({
    action: "auth",
    entityType: "session",
    routeName: input.routeName,
    success: input.success,
    context: input.context,
    errorMessage: input.errorMessage,
    adminUserId: input.adminUserId,
  });
}
