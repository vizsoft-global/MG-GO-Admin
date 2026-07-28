import { headers } from "next/headers";
import type { Json } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";

const READ_THROTTLE_MS = 60_000;
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

    const supabase = await createClient();
    await supabase.from("admin_activity_logs").insert({
      admin_user_id: adminUserId,
      admin_role_slug: adminRoleSlug,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      page_path: input.pagePath ?? null,
      route_name: input.routeName ?? null,
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
      context: (input.context ?? {}) as Json,
      before_state: (input.before ?? null) as Json,
      after_state: (input.after ?? null) as Json,
      changed_fields: changedFields,
      ip_address: ipAddress,
      user_agent: userAgent,
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

export async function logAdminRead(
  entityType: string,
  routeName: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const key = `read:${routeName}:${entityType}`;
  if (shouldThrottleRead(key)) return;
  await logAdminActivity({
    action: "read",
    entityType,
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
