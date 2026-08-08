"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { buildActionPayload, buildFcmDataPayload } from "./payload-contract";
import { DEFAULT_TIMEZONE, NOTIFICATIONS_CAMPAIGNS_PAGE_SIZE, PAYLOAD_VERSION, requiresApproval } from "./constants";
import {
  parseNotificationMedia,
  pickPushNotificationImageKey,
  resolveNotificationMediaReadUrl,
} from "./notification-media";
import { uploadNotificationMediaFile } from "./notification-media-storage";
import { sendPushBatch } from "@/lib/firebase/fcm-provider";
import { interpolateTemplate } from "./interpolate-template";
import { resolveScreenshotRestricted } from "./screenshot-restriction";
import { resolveDriversByLookupIds } from "@/features/drivers/resolve-drivers-by-lookup-ids";
import type {
  NotificationActionError,
  NotificationAnalyticsDailyRow,
  NotificationAutomationRow,
  NotificationCampaignRow,
  NotificationCategory,
  NotificationDashboardKpis,
  NotificationListFilters,
  NotificationScreenshotEventRow,
  NotificationTemplateRow,
  SaveAutomationInput,
  SaveCampaignInput,
  SaveTemplateInput,
  TargetSpec,
  NotificationImportSpec,
} from "./types";

const KUWAIT_TZ = DEFAULT_TIMEZONE;

async function notificationsDb() {
  return (await createClient()) as any;
}

function notificationsAdminDb() {
  return createAdminClient() as any;
}

async function requireNotificationsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "notifications.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireNotificationsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "notifications.manage", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

async function requireNotificationsSend() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "notifications.send", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

async function requireNotificationsApprove() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "notifications.approve", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

async function ensureCampaignApprovedForDispatch(
  campaignId: string,
  session: NonNullable<Awaited<ReturnType<typeof requireNotificationsSend>>>,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const supabase = await notificationsDb();
  const { data: campaign } = await supabase
    .from("notification_campaigns")
    .select("requires_approval, approved_at, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { error: "not_found" };

  if (!campaign.requires_approval || campaign.approved_at) {
    return { ok: true };
  }

  if (
    !hasPermissionInSet(session.permissions, "notifications.approve", session.isSuperAdmin)
  ) {
    return { error: "approval_required" };
  }

  const { error } = await supabase
    .from("notification_campaigns")
    .update({
      approved_by: session.id,
      approved_at: new Date().toISOString(),
      updated_by: session.id,
      status: ["draft", "pending_approval"].includes(campaign.status)
        ? "queued"
        : campaign.status,
    })
    .eq("id", campaignId)
    .is("approved_at", null);
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "update",
    entityType: "notification_campaign",
    entityId: campaignId,
    routeName: "notifications",
    context: { step: "auto_approve_on_dispatch" },
  });
  return { ok: true };
}

async function estimateAudienceCount(
  supabase: Awaited<ReturnType<typeof notificationsDb>>,
  targetSpec: TargetSpec,
  exclusionSpec: Record<string, unknown> = {},
  importSpec?: NotificationImportSpec,
): Promise<number> {
  const { data, error } = await supabase.rpc("estimate_notification_audience", {
    p_target_spec: targetSpec,
    p_exclusion_spec: exclusionSpec,
    p_import_spec: importSpec ?? {},
  });
  if (error) {
    console.error("[notifications] estimate_notification_audience failed:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

function validateCampaignInput(input: SaveCampaignInput): NotificationActionError | null {
  if (!input.title.trim() || !input.body.trim()) {
    return "invalid_input";
  }

  const mode = input.targetSpec.mode;
  if (mode === "custom" && !(input.targetSpec.driver_ids?.length ?? 0)) {
    return "empty_recipients";
  }
  if (mode === "zone" && !(input.targetSpec.zone_ids?.length ?? 0)) {
    return "empty_recipients";
  }
  if (mode === "partner" && !(input.targetSpec.partner_ids?.length ?? 0)) {
    return "empty_recipients";
  }
  if (mode === "group" && !(input.targetSpec.group_ids?.length ?? 0)) {
    return "empty_recipients";
  }
  if (mode === "import" && !(input.importSpec?.rows.length ?? 0)) {
    return "empty_recipients";
  }

  return null;
}

function kuwaitToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KUWAIT_TZ }).format(new Date());
}

function mapCampaign(row: Record<string, unknown>): NotificationCampaignRow {
  return {
    ...(row as unknown as NotificationCampaignRow),
    media: parseNotificationMedia(row.media),
    screenshot_restricted_override:
      (row.screenshot_restricted_override as boolean | null | undefined) ?? null,
    screenshot_restricted: Boolean(row.screenshot_restricted),
  };
}

export async function getNotificationDashboardKpis(): Promise<NotificationDashboardKpis> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const today = kuwaitToday();
  const start = `${today}T00:00:00+03:00`;

  const [sentRes, scheduledRes, draftsRes, failedRes, automationsRes, activityRes, campaignsRes] =
    await Promise.all([
      supabase
        .from("notification_campaigns")
        .select("id", { count: "exact", head: true })
        .gte("sent_at", start)
        .in("status", ["sent", "delivered", "opened", "clicked"]),
      supabase
        .from("notification_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "scheduled"),
      supabase
        .from("notification_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase
        .from("notification_campaigns")
        .select("failed_count")
        .gte("created_at", start),
      supabase
        .from("notification_automations")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("notification_events")
        .select("id", { count: "exact", head: true })
        .gte("occurred_at", start),
      supabase
        .from("notification_campaigns")
        .select("recipient_count, delivered_count, opened_count, failed_count")
        .gte("sent_at", start),
    ]);

  const campaigns = campaignsRes.data ?? [];
  const totalRecipients = campaigns.reduce(
    (sum: number, c: { recipient_count?: number }) => sum + (c.recipient_count ?? 0),
    0,
  );
  const totalDelivered = campaigns.reduce(
    (sum: number, c: { delivered_count?: number }) => sum + (c.delivered_count ?? 0),
    0,
  );
  const totalOpened = campaigns.reduce(
    (sum: number, c: { opened_count?: number }) => sum + (c.opened_count ?? 0),
    0,
  );
  const failedToday = (failedRes.data ?? []).reduce(
    (sum: number, c: { failed_count?: number }) => sum + (c.failed_count ?? 0),
    0,
  );

  await logAdminRead("notifications", "dashboard", {});

  return {
    sentToday: sentRes.count ?? 0,
    scheduled: scheduledRes.count ?? 0,
    drafts: draftsRes.count ?? 0,
    deliveryRate: totalRecipients > 0 ? Math.round((totalDelivered / totalRecipients) * 100) : 0,
    failedDeliveries: failedToday,
    openRate: totalDelivered > 0 ? Math.round((totalOpened / totalDelivered) * 100) : 0,
    activeAutomations: automationsRes.count ?? 0,
    recentActivity: activityRes.count ?? 0,
  };
}

function applyNotificationCampaignFilters<
  T extends {
    eq: (column: string, value: string) => T;
    or: (filters: string) => T;
    gte: (column: string, value: string) => T;
    lte: (column: string, value: string) => T;
  },
>(query: T, filters: NotificationListFilters): T {
  let next = query;
  if (filters.status && filters.status !== "all") {
    next = next.eq("status", filters.status);
  }
  if (filters.category && filters.category !== "all") {
    next = next.eq("category", filters.category);
  }
  if (filters.search?.trim()) {
    next = next.or(
      `title.ilike.%${filters.search.trim()}%,body.ilike.%${filters.search.trim()}%`,
    );
  }
  if (filters.fromDate) next = next.gte("created_at", `${filters.fromDate}T00:00:00`);
  if (filters.toDate) next = next.lte("created_at", `${filters.toDate}T23:59:59`);
  return next;
}

export async function listNotificationCampaignsPage(params: {
  filters?: NotificationListFilters;
  limit?: number;
  page?: number;
}): Promise<{
  rows: NotificationCampaignRow[];
  totalCount: number;
  hasMore: boolean;
}> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const filters = params.filters ?? {};
  const limit = params.limit ?? NOTIFICATIONS_CAMPAIGNS_PAGE_SIZE;
  const page = params.page ?? 0;
  const from = page * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("notification_campaigns")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  query = applyNotificationCampaignFilters(query, filters);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  await logAdminRead("notifications", "list", filters as Record<string, unknown>);

  const rows = (data ?? []).map((row: Record<string, unknown>) => mapCampaign(row));
  const totalCount = count ?? rows.length;
  const hasMore = from + rows.length < totalCount;

  return { rows, totalCount, hasMore };
}

export async function listNotificationCampaigns(
  filters: NotificationListFilters = {},
): Promise<NotificationCampaignRow[]> {
  const { rows } = await listNotificationCampaignsPage({
    filters,
    limit: 1000,
    page: 0,
  });
  return rows;
}

export type NotificationDispatchItemRow = {
  id: string;
  driver_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  delivered_at: string | null;
  employee_id: string | null;
  driver_label: string;
  engagement_seen: boolean;
  engagement_tapped: boolean;
};

export async function getNotificationDispatchItems(
  campaignId: string,
): Promise<NotificationDispatchItemRow[]> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_dispatch_items")
    .select(
      "id, driver_id, status, error_code, error_message, sent_at, opened_at, clicked_at, delivered_at, drivers(driver_code, employee_id, profiles(full_name))",
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const drivers = row.drivers as
      | {
          driver_code?: string;
          employee_id?: string | null;
          profiles?: { full_name?: string | null } | Array<{ full_name?: string | null }>;
        }
      | null;
    const profile = Array.isArray(drivers?.profiles) ? drivers?.profiles[0] : drivers?.profiles;
    const name = profile?.full_name?.trim() || "Driver";
    const code = drivers?.driver_code ?? "—";
    return {
      id: row.id as string,
      driver_id: row.driver_id as string,
      status: row.status as string,
      error_code: (row.error_code as string | null) ?? null,
      error_message: (row.error_message as string | null) ?? null,
      sent_at: (row.sent_at as string | null) ?? null,
      opened_at: (row.opened_at as string | null) ?? null,
      clicked_at: (row.clicked_at as string | null) ?? null,
      delivered_at: (row.delivered_at as string | null) ?? null,
      employee_id: drivers?.employee_id ?? null,
      driver_label: `${code} · ${name}`,
      engagement_seen: Boolean(row.opened_at),
      engagement_tapped: Boolean(row.clicked_at),
    };
  });
}

export async function getNotificationCampaign(
  id: string,
): Promise<NotificationCampaignRow | null> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

export async function estimateNotificationAudience(
  targetSpec: TargetSpec,
  exclusionSpec: Record<string, unknown> = {},
  importSpec?: NotificationImportSpec,
): Promise<number> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase.rpc("estimate_notification_audience", {
    p_target_spec: targetSpec,
    p_exclusion_spec: exclusionSpec,
    p_import_spec: importSpec ?? {},
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function uploadNotificationMedia(
  formData: FormData,
): Promise<
  { objectKey: string } | { error: NotificationActionError | "file_too_large" | "invalid_type" | "upload_failed" }
> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const entry = formData.get("file");
  // Next may deserialize the part as File or Blob depending on runtime.
  if (!(entry instanceof Blob) || entry.size === 0) return { error: "invalid_input" };
  const file =
    entry instanceof File
      ? entry
      : new File([entry], "upload.bin", { type: entry.type || "application/octet-stream" });

  try {
    const result = await uploadNotificationMediaFile(file, session.id);
    if (result.error) return { error: result.error };
    if (!result.objectKey) return { error: "invalid_input" };
    return { objectKey: result.objectKey };
  } catch {
    return { error: "upload_failed" };
  }
}

async function loadTemplateScreenshotFlag(
  supabase: Awaited<ReturnType<typeof notificationsDb>>,
  templateId: string | null | undefined,
): Promise<boolean> {
  if (!templateId) return false;
  const { data } = await supabase
    .from("notification_templates")
    .select("screenshot_restricted")
    .eq("id", templateId)
    .maybeSingle();
  return Boolean(data?.screenshot_restricted);
}

export async function saveNotificationCampaign(
  input: SaveCampaignInput,
  campaignId?: string | null,
): Promise<{ id: string } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const validationError = validateCampaignInput(input);
  if (validationError) return { error: validationError };

  const needsApproval = requiresApproval({
    category: input.category,
    priority: input.priority,
    targetMode: input.targetSpec.mode,
  });

  const supabase = await notificationsDb();
  const audience = await estimateAudienceCount(
    supabase,
    input.targetSpec,
    input.exclusionSpec ?? {},
    input.importSpec,
  );

  const override =
    input.screenshotRestrictedOverride === undefined
      ? null
      : input.screenshotRestrictedOverride;
  const templateFlag = await loadTemplateScreenshotFlag(supabase, input.templateId);
  const screenshotRestricted = resolveScreenshotRestricted(override, templateFlag);

  const row = {
    title: input.title.trim(),
    body: input.body.trim(),
    category: input.category,
    priority: input.priority,
    template_id: input.templateId ?? null,
    target_spec: input.targetSpec,
    exclusion_spec: input.exclusionSpec ?? {},
    import_spec: input.importSpec ?? {},
    track_engagement: input.trackEngagement ?? true,
    action_type: input.actionType,
    action_params: input.actionParams ?? {},
    payload_version: PAYLOAD_VERSION,
    media: input.media ?? [],
    schedule_spec: input.scheduleSpec,
    timezone: input.timezone ?? KUWAIT_TZ,
    scheduled_for: input.scheduleSpec.scheduled_for ?? null,
    expires_at: input.expiresAt ?? null,
    send_limit: input.sendLimit ?? null,
    requires_approval: needsApproval,
    estimated_audience_count: audience,
    screenshot_restricted_override: override,
    screenshot_restricted: screenshotRestricted,
    updated_by: session.id,
  };

  if (campaignId) {
    const { data, error } = await supabase
      .from("notification_campaigns")
      .update(row)
      .eq("id", campaignId)
      .in("status", ["draft", "pending_approval", "scheduled"])
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: "save_failed" };
    await logAdminMutation({
      action: "update",
      entityType: "notification_campaign",
      entityId: data.id,
      routeName: "notifications",
      context: { campaignId: data.id },
    });
    return { id: data.id };
  }

  const { data, error } = await supabase
    .from("notification_campaigns")
    .insert({ ...row, created_by: session.id, status: "draft" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[notifications] save campaign insert failed:", error?.message);
    return { error: "save_failed" };
  }
  await logAdminMutation({
    action: "create",
    entityType: "notification_campaign",
    entityId: data.id,
    routeName: "notifications",
    context: { campaignId: data.id },
  });
  return { id: data.id };
}

export async function submitNotificationForApproval(
  campaignId: string,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { error } = await supabase
    .from("notification_campaigns")
    .update({
      status: "pending_approval",
      submitted_for_approval_at: new Date().toISOString(),
      updated_by: session.id,
    })
    .eq("id", campaignId)
    .eq("status", "draft");
  if (error) return { error: "save_failed" };
  await logAdminMutation({
    action: "update",
    entityType: "notification_campaign",
    entityId: campaignId,
    routeName: "notifications",
    context: { step: "submit_approval" },
  });
  return { ok: true };
}

export async function approveNotificationCampaign(
  campaignId: string,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsApprove();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { data: campaign } = await supabase
    .from("notification_campaigns")
    .select("schedule_spec, scheduled_for")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { error: "not_found" };

  const scheduleSpec = campaign.schedule_spec as { mode?: string } | null;
  const nextStatus =
    scheduleSpec?.mode === "later" || campaign.scheduled_for ? "scheduled" : "queued";

  const { error } = await supabase
    .from("notification_campaigns")
    .update({
      status: nextStatus,
      approved_by: session.id,
      approved_at: new Date().toISOString(),
      updated_by: session.id,
    })
    .eq("id", campaignId)
    .in("status", ["draft", "pending_approval"]);
  if (error) return { error: "save_failed" };
  await logAdminMutation({
    action: "update",
    entityType: "notification_campaign",
    entityId: campaignId,
    routeName: "notifications",
    context: { step: "approve" },
  });
  return { ok: true };
}

export async function dispatchNotificationCampaign(
  campaignId: string,
): Promise<{ ok: true; sent: number; failed: number } | { error: NotificationActionError }> {
  const session = await requireNotificationsSend();
  if (!session) return { error: "not_authorized" };

  const approval = await ensureCampaignApprovedForDispatch(campaignId, session);
  if ("error" in approval) return approval;

  return executeNotificationDispatch(campaignId, session.id);
}

async function executeNotificationDispatch(
  campaignId: string,
  actorUserId: string | null,
): Promise<{ ok: true; sent: number; failed: number } | { error: NotificationActionError }> {
  let service;
  try {
    service = notificationsAdminDb();
  } catch (error) {
    console.error("[notifications] admin client unavailable:", error);
    return { error: "dispatch_failed" };
  }

  const { data: campaign, error: campaignError } = await service
    .from("notification_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError || !campaign) return { error: "not_found" };

  const { data: remoteConfig } = await service
    .from("notification_remote_config")
    .select("global_enabled, emergency_gate_enabled, category_throttles")
    .eq("id", 1)
    .maybeSingle();

  if (remoteConfig && remoteConfig.global_enabled === false) {
    return { error: "dispatch_failed" };
  }
  if (
    campaign.category === "emergency" &&
    remoteConfig?.emergency_gate_enabled === false
  ) {
    return { error: "dispatch_failed" };
  }

  if (campaign.requires_approval && !campaign.approved_at) {
    return { error: "approval_required" };
  }

  const targetSpec = campaign.target_spec as TargetSpec;
  const exclusionSpec = (campaign.exclusion_spec ?? {}) as Record<string, unknown>;
  const importSpec = (campaign.import_spec ?? {}) as NotificationImportSpec;

  type Personalization = {
    title: string;
    body: string;
    rowIndex: number;
    vars: Record<string, string>;
  };
  const personalizationByDriver = new Map<string, Personalization>();

  if (targetSpec.mode === "import" && importSpec.rows?.length) {
    const employeeIds = importSpec.rows
      .map((row) => row.employee_id?.trim())
      .filter(Boolean);
    const { data: driverRows } = await service
      .from("drivers")
      .select("id, employee_id")
      .in("employee_id", employeeIds)
      .is("archived_at", null);
    const employeeToDriver = new Map(
      (driverRows ?? []).map((d: { id: string; employee_id: string }) => [d.employee_id, d.id]),
    );
    importSpec.rows.forEach((row, index) => {
      const emp = row.employee_id?.trim();
      if (!emp) return;
      const driverId = employeeToDriver.get(emp) as string | undefined;
      if (!driverId) return;
      personalizationByDriver.set(driverId, {
        title: interpolateTemplate(String(campaign.title), row),
        body: interpolateTemplate(String(campaign.body), row),
        rowIndex: index,
        vars: row,
      });
    });
  }

  const { data: snapshotId, error: snapshotError } = await service.rpc(
    "compile_notification_audience",
    {
      p_campaign_id: campaignId,
      p_target_spec: targetSpec,
      p_exclusion_spec: exclusionSpec,
    },
  );
  if (snapshotError) return { error: "dispatch_failed" };

  const { data: snapshot } = await service
    .from("notification_audience_snapshots")
    .select("recipient_ids, recipient_count")
    .eq("id", snapshotId)
    .single();

  const recipientIds = (snapshot?.recipient_ids ?? []) as string[];
  if (recipientIds.length === 0) return { error: "empty_audience" };

  const idempotencyKey = `campaign:${campaignId}:${Date.now()}`;
  const { data: run, error: runError } = await service
    .from("notification_dispatch_runs")
    .insert({
      campaign_id: campaignId,
      snapshot_id: snapshotId,
      status: "processing",
      idempotency_key: idempotencyKey,
      started_at: new Date().toISOString(),
      total_count: recipientIds.length,
    })
    .select("id")
    .single();
  if (runError || !run) return { error: "dispatch_failed" };

  const { data: tokens } = await service
    .from("driver_push_tokens")
    .select("id, driver_id, token")
    .in("driver_id", recipientIds)
    .eq("is_active", true);

  type TokenRow = { driver_id: string; id: string; token: string };
  const tokenByDriver = new Map<string, TokenRow>(
    (tokens ?? []).map((t: TokenRow) => [t.driver_id, t]),
  );
  const action = buildActionPayload({
    actionType: campaign.action_type,
    actionParams: (campaign.action_params ?? {}) as Record<string, unknown>,
    campaignId,
  });
  const campaignMedia = parseNotificationMedia(campaign.media);
  const pushImageKey = pickPushNotificationImageKey(campaignMedia);
  const pushImageUrl = pushImageKey
    ? await resolveNotificationMediaReadUrl(pushImageKey)
    : null;

  // Pre-create one dispatch_items row per recipient so each FCM push can
  // include its own dispatch_item_id in the data payload. Without this
  // the rider app receives the push but cannot record delivered/opened/
  // clicked events (the rider RPC requires both campaign_id + dispatch_item_id).
  const pendingItemRows = recipientIds.map((driverId: string) => {
    const tokenRow = tokenByDriver.get(driverId);
    const personalized = personalizationByDriver.get(driverId);
    return {
      run_id: run.id,
      campaign_id: campaignId,
      driver_id: driverId,
      push_token_id: tokenRow?.id ?? null,
      status: tokenRow ? "pending" : "skipped",
      error_code: tokenRow ? null : "no_token",
      error_message: tokenRow ? null : "No active push token",
      resolved_title: personalized?.title ?? null,
      resolved_body: personalized?.body ?? null,
      import_row_index: personalized?.rowIndex ?? null,
      import_vars: personalized?.vars ?? null,
    };
  });
  const { data: insertedItems, error: insertError } = await service
    .from("notification_dispatch_items")
    .insert(pendingItemRows)
    .select("id, driver_id");
  if (insertError) {
    return { error: "dispatch_failed" };
  }
  const dispatchIdByDriver = new Map<string, string>(
    (insertedItems ?? []).map((row: { id: string; driver_id: string }) => [
      row.driver_id,
      row.id,
    ]),
  );

  const messages = recipientIds
    .map((driverId: string) => {
      const tokenRow = tokenByDriver.get(driverId);
      const dispatchItemId = dispatchIdByDriver.get(driverId);
      if (!tokenRow || !dispatchItemId) return null;
      const personalized = personalizationByDriver.get(driverId);
      return {
        token: tokenRow.token,
        title: personalized?.title ?? campaign.title,
        body: personalized?.body ?? campaign.body,
        data: buildFcmDataPayload({
          campaignId,
          dispatchItemId,
          action,
          category: campaign.category,
          priority: campaign.priority,
          screenshotRestricted: Boolean(campaign.screenshot_restricted),
          media: campaignMedia,
          imageUrl: pushImageUrl,
        }),
        imageUrl: pushImageUrl,
        driverId,
        pushTokenId: tokenRow.id,
        dispatchItemId,
      };
    })
    .filter(Boolean) as Array<{
    token: string;
    title: string;
    body: string;
    data: Record<string, string>;
    imageUrl: string | null;
    driverId: string;
    pushTokenId: string;
    dispatchItemId: string;
  }>;

  const batchResult = await sendPushBatch(messages);

  // FCM error codes that mean the token is permanently dead — deactivate so
  // future campaigns skip it cleanly instead of re-erroring on every retry.
  const DEAD_TOKEN_CODES = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
    "messaging/sender-id-mismatch",
    "messaging/mismatched-credential",
  ]);

  const nowIso = new Date().toISOString();
  const deadTokenIds: string[] = [];
  for (const message of messages) {
    const messageId = batchResult.messageIds.find(
      (m) => m.token === message.token,
    )?.messageId;
    const err = batchResult.errors.find((e) => e.token === message.token);
    if (err && DEAD_TOKEN_CODES.has(err.code)) {
      deadTokenIds.push(message.pushTokenId);
    }
    await service
      .from("notification_dispatch_items")
      .update({
        status: messageId ? "sent" : "failed",
        provider_message_id: messageId ?? null,
        error_code: err?.code ?? null,
        error_message: err?.message ?? null,
        sent_at: messageId ? nowIso : null,
      })
      .eq("id", message.dispatchItemId);
  }

  if (deadTokenIds.length > 0) {
    await service
      .from("driver_push_tokens")
      .update({ is_active: false, updated_at: nowIso })
      .in("id", deadTokenIds);
  }

  const sentCount = batchResult.successCount;
  const failedCount = recipientIds.length - sentCount;

  await service
    .from("notification_dispatch_runs")
    .update({
      status: failedCount === recipientIds.length ? "failed" : "sent",
      sent_count: sentCount,
      failed_count: failedCount,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  await service
    .from("notification_campaigns")
    .update({
      status: failedCount === recipientIds.length ? "failed" : "sent",
      sent_at: new Date().toISOString(),
      recipient_count: recipientIds.length,
      failed_count: failedCount,
      delivered_count: sentCount,
      updated_by: actorUserId,
    })
    .eq("id", campaignId);

  if (actorUserId) {
    await logAdminMutation({
      action: "update",
      entityType: "notification_campaign",
      entityId: campaignId,
      routeName: "notifications",
      context: { sentCount, failedCount },
    });
  }
  return { ok: true, sent: sentCount, failed: failedCount };
}

export async function cloneNotificationCampaign(
  campaignId: string,
): Promise<{ id: string } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { data: source, error } = await supabase
    .from("notification_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error || !source) return { error: "not_found" };

  const { data, error: insertError } = await supabase
    .from("notification_campaigns")
    .insert({
      title: `${source.title} (copy)`,
      body: source.body,
      category: source.category,
      priority: source.priority,
      template_id: source.template_id,
      target_spec: source.target_spec,
      exclusion_spec: source.exclusion_spec,
      action_type: source.action_type,
      action_params: source.action_params,
      payload_version: source.payload_version,
      media: source.media ?? [],
      schedule_spec: source.schedule_spec,
      timezone: source.timezone,
      requires_approval: source.requires_approval,
      estimated_audience_count: source.estimated_audience_count,
      screenshot_restricted_override: source.screenshot_restricted_override ?? null,
      screenshot_restricted: Boolean(source.screenshot_restricted),
      cloned_from_id: campaignId,
      status: "draft",
      created_by: session.id,
      updated_by: session.id,
    })
    .select("id")
    .single();
  if (insertError || !data) return { error: "save_failed" };
  await logAdminMutation({
    action: "create",
    entityType: "notification_campaign",
    entityId: data.id,
    routeName: "notifications",
    context: { sourceId: campaignId, cloned: true },
  });
  return { id: data.id };
}

export async function listNotificationTemplates(): Promise<NotificationTemplateRow[]> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_templates")
    .select("*")
    .eq("is_archived", false)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationTemplateRow[];
}

export async function listNotificationAutomations(): Promise<NotificationAutomationRow[]> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_automations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationAutomationRow[];
}

export async function getNotificationTargetingOptions(): Promise<{
  zones: Array<{ id: string; name: string }>;
  partners: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string; member_count: number }>;
  drivers: Array<{ id: string; label: string }>;
}> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const [zonesRes, partnersRes, groupsRes] = await Promise.all([
    supabase.from("zones").select("id, name").order("name"),
    supabase.from("partners").select("id, name").order("name"),
    (supabase as any).from("driver_groups").select("id, name, member_count").order("name"),
  ]);

  return {
    zones: (zonesRes.data ?? []).map((z: { id: string; name: string }) => ({ id: z.id, name: z.name })),
    partners: (partnersRes.data ?? []).map((p: { id: string; name: string }) => ({
      id: p.id,
      name: p.name,
    })),
    groups: (groupsRes.data ?? []).map((g: { id: string; name: string; member_count: number }) => ({
      id: g.id,
      name: g.name,
      member_count: g.member_count,
    })),
    drivers: [],
  };
}

export async function searchDriversForNotification(
  query: string,
  limit = 30,
): Promise<
  Array<{
    id: string;
    label: string;
    employee_id: string;
    driver_code: string;
    full_name: string;
  }>
> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const term = query.trim();
  if (!term) return [];

  let q = supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles(full_name)")
    .is("archived_at", null)
    .limit(limit);

  if (/^\d+$/.test(term)) {
    q = q.or(`employee_id.eq.${term},driver_code.ilike.%${term}%`);
  } else {
    q = q.or(`driver_code.ilike.%${term}%,employee_id.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((d: any) => {
    const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    const full_name = profile?.full_name?.trim() || "Driver";
    return {
      id: d.id,
      label: `${d.driver_code} · ${full_name}`,
      employee_id: d.employee_id ?? "",
      driver_code: d.driver_code,
      full_name,
    };
  });
}

export async function resolveNotificationDriversByEmployeeIds(employeeIds: string[]) {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const resolved = await resolveDriversByLookupIds(supabase, employeeIds);
  return resolved.map((row) => ({
    employee_id: row.employee_id,
    driver_id: row.driver_id,
    driver_code: row.driver_code,
    full_name: row.full_name,
    error: row.error,
  }));
}

export async function previewNotificationImport(input: {
  titleTemplate: string;
  bodyTemplate: string;
  importSpec: NotificationImportSpec;
}) {
  await requireNotificationsView();
  const employeeIds = input.importSpec.rows
    .map((row) => row.employee_id?.trim())
    .filter(Boolean);
  const resolved = await resolveNotificationDriversByEmployeeIds(employeeIds);
  const byEmployee = new Map(resolved.map((r) => [r.employee_id, r]));

  return input.importSpec.rows.map((row, row_index) => {
    const employee_id = row.employee_id?.trim() ?? "";
    const match = byEmployee.get(employee_id);
    let status = "ok";
    if (!match) status = "unknown_employee_id";
    else if (match.error === "blocked") status = "blocked";
    else if (match.error === "not_found") status = "unknown_employee_id";

    return {
      row_index,
      employee_id,
      driver_name: match?.full_name ?? null,
      status,
      resolved_title: interpolateTemplate(input.titleTemplate, row),
      resolved_body: interpolateTemplate(input.bodyTemplate, row),
    };
  });
}

export async function exportNotificationDispatchItemsCsv(
  campaignId: string,
): Promise<{ csv: string } | { error: NotificationActionError }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "notifications.export", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  const items = await getNotificationDispatchItems(campaignId);
  const header = [
    "driver",
    "employee_id",
    "delivery_status",
    "seen",
    "seen_at",
    "tapped",
    "tapped_at",
    "error",
  ];
  const lines = items.map((item) =>
    [
      `"${item.driver_label.replace(/"/g, '""')}"`,
      item.employee_id ?? "",
      item.status,
      item.engagement_seen ? "yes" : "no",
      item.opened_at ?? "",
      item.engagement_tapped ? "yes" : "no",
      item.clicked_at ?? "",
      item.error_code ?? "",
    ].join(","),
  );
  return { csv: [header.join(","), ...lines].join("\n") };
}

export async function scheduleNotificationCampaign(
  campaignId: string,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { data: campaign } = await supabase
    .from("notification_campaigns")
    .select("requires_approval, scheduled_for, schedule_spec")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign?.scheduled_for) return { error: "invalid_input" };

  const nextStatus = campaign.requires_approval ? "pending_approval" : "scheduled";
  const { error } = await supabase
    .from("notification_campaigns")
    .update({
      status: nextStatus,
      updated_by: session.id,
      ...(nextStatus === "pending_approval"
        ? { submitted_for_approval_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", campaignId)
    .in("status", ["draft"]);
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "update",
    entityType: "notification_campaign",
    entityId: campaignId,
    routeName: "notifications",
    context: { step: "schedule" },
  });
  return { ok: true };
}

export async function rejectNotificationCampaign(
  campaignId: string,
  reason?: string,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsApprove();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { error } = await supabase
    .from("notification_campaigns")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_by: session.id,
    })
    .eq("id", campaignId)
    .eq("status", "pending_approval");
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "update",
    entityType: "notification_campaign",
    entityId: campaignId,
    routeName: "notifications",
    context: { step: "reject", reason: reason ?? null },
  });
  return { ok: true };
}

export async function cancelNotificationCampaign(
  campaignId: string,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { error } = await supabase
    .from("notification_campaigns")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_by: session.id,
    })
    .eq("id", campaignId)
    .in("status", ["draft", "pending_approval", "scheduled", "queued"]);
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "update",
    entityType: "notification_campaign",
    entityId: campaignId,
    routeName: "notifications",
    context: { step: "cancel" },
  });
  return { ok: true };
}

export async function exportNotificationCampaignsCsv(
  filters: NotificationListFilters = {},
): Promise<{ csv: string } | { error: NotificationActionError }> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "notifications.export", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }

  const rows = await listNotificationCampaigns(filters);
  const header = [
    "id",
    "title",
    "category",
    "priority",
    "status",
    "audience",
    "sent_at",
    "delivered",
    "opened",
    "failed",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      `"${row.title.replace(/"/g, '""')}"`,
      row.category,
      row.priority,
      row.status,
      row.recipient_count || row.estimated_audience_count,
      row.sent_at ?? "",
      row.delivered_count,
      row.opened_count,
      row.failed_count,
    ].join(","),
  );
  await logAdminRead("notifications", "export", filters as Record<string, unknown>);
  return { csv: [header.join(","), ...lines].join("\n") };
}

export async function getNotificationTemplate(
  id: string,
): Promise<NotificationTemplateRow | null> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as NotificationTemplateRow) : null;
}

export async function getNotificationAutomation(
  id: string,
): Promise<NotificationAutomationRow | null> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_automations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...(data as NotificationAutomationRow),
    target_spec: (data.target_spec ?? { mode: "all" }) as TargetSpec,
    exclusion_spec: (data.exclusion_spec ?? {}) as NotificationAutomationRow["exclusion_spec"],
  };
}

export async function listNotificationAnalyticsDaily(filters: {
  fromDate?: string;
  toDate?: string;
} = {}): Promise<NotificationAnalyticsDailyRow[]> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  let query = supabase
    .from("notification_analytics_daily")
    .select("*, notification_campaigns(title, category)")
    .order("metric_date", { ascending: false })
    .limit(200);
  if (filters.fromDate) query = query.gte("metric_date", filters.fromDate);
  if (filters.toDate) query = query.lte("metric_date", filters.toDate);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => {
    const rawCampaign = row.notification_campaigns;
    const campaign = Array.isArray(rawCampaign) ? rawCampaign[0] : rawCampaign;
    return {
      metric_date: String(row.metric_date),
      campaign_id: String(row.campaign_id),
      sent_count: Number(row.sent_count ?? 0),
      delivered_count: Number(row.delivered_count ?? 0),
      opened_count: Number(row.opened_count ?? 0),
      clicked_count: Number(row.clicked_count ?? 0),
      failed_count: Number(row.failed_count ?? 0),
      campaign:
        campaign && typeof campaign === "object" && "title" in campaign
          ? {
              title: String((campaign as { title: string }).title),
              category: (campaign as { category: NotificationCategory }).category,
            }
          : null,
    } satisfies NotificationAnalyticsDailyRow;
  });
}

export async function listNotificationAutomationRuns(
  automationId: string,
): Promise<Array<Record<string, unknown>>> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_automation_runs")
    .select("*")
    .eq("automation_id", automationId)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveNotificationTemplate(
  input: SaveTemplateInput,
): Promise<{ id: string } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim() || !input.titleTemplate.trim() || !input.bodyTemplate.trim()) {
    return { error: "invalid_input" };
  }

  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_templates")
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      priority: input.priority,
      title_template: input.titleTemplate.trim(),
      body_template: input.bodyTemplate.trim(),
      variable_schema: input.variableSchema ?? [],
      action_type: input.actionType,
      action_params: input.actionParams ?? {},
      screenshot_restricted: Boolean(input.screenshotRestricted),
      created_by: session.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "save_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "notification_template",
    entityId: data.id,
    routeName: "notifications/templates",
    context: { name: input.name },
  });
  return { id: data.id };
}

export async function updateNotificationTemplate(
  id: string,
  input: SaveTemplateInput,
): Promise<{ id: string } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim() || !input.titleTemplate.trim() || !input.bodyTemplate.trim()) {
    return { error: "invalid_input" };
  }

  const screenshotRestricted = Boolean(input.screenshotRestricted);
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_templates")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      priority: input.priority,
      title_template: input.titleTemplate.trim(),
      body_template: input.bodyTemplate.trim(),
      variable_schema: input.variableSchema ?? [],
      action_type: input.actionType,
      action_params: input.actionParams ?? {},
      screenshot_restricted: screenshotRestricted,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("is_archived", false)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "not_found" };

  // Refresh stamp on editable campaigns that inherit this template.
  await supabase
    .from("notification_campaigns")
    .update({
      screenshot_restricted: screenshotRestricted,
      updated_at: new Date().toISOString(),
    })
    .eq("template_id", id)
    .is("screenshot_restricted_override", null)
    .in("status", ["draft", "pending_approval", "scheduled"]);

  await logAdminMutation({
    action: "update",
    entityType: "notification_template",
    entityId: id,
    routeName: "notifications/templates",
    context: { name: input.name },
  });
  return { id: data.id };
}

export async function listCampaignScreenshotEvents(
  campaignId: string,
): Promise<NotificationScreenshotEventRow[]> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_events")
    .select("id, campaign_id, dispatch_item_id, driver_id, occurred_at, metadata")
    .eq("campaign_id", campaignId)
    .eq("event_type", "screenshot_taken")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    campaign_id: string;
    dispatch_item_id: string | null;
    driver_id: string;
    occurred_at: string;
    metadata: Record<string, unknown> | null;
  }>;
  if (rows.length === 0) return [];

  const driverIds = [...new Set(rows.map((r) => r.driver_id))];
  const { data: drivers } = await supabase
    .from("drivers")
    .select("id, driver_code, profiles(full_name)")
    .in("id", driverIds);
  const byId = new Map(
    (
      (drivers ?? []) as Array<{
        id: string;
        driver_code: string | null;
        profiles?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
      }>
    ).map((d) => {
      const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
      return [d.id, { driver_code: d.driver_code, full_name: profile?.full_name ?? null }] as const;
    }),
  );

  return rows.map((row) => {
    const driver = byId.get(row.driver_id);
    return {
      id: row.id,
      campaign_id: row.campaign_id,
      dispatch_item_id: row.dispatch_item_id,
      driver_id: row.driver_id,
      occurred_at: row.occurred_at,
      metadata: row.metadata ?? {},
      driver_code: driver?.driver_code ?? null,
      driver_name: driver?.full_name ?? null,
    };
  });
}

export async function archiveNotificationTemplate(
  id: string,
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const { error } = await supabase
    .from("notification_templates")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "delete",
    entityType: "notification_template",
    entityId: id,
    routeName: "notifications/templates",
    context: { archived: true },
  });
  return { ok: true };
}

export async function saveNotificationAutomation(
  input: SaveAutomationInput,
): Promise<{ id: string } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim()) return { error: "invalid_input" };

  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_automations")
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig ?? {},
      condition_spec: input.conditionSpec ?? {},
      target_spec: input.targetSpec ?? { mode: "all" },
      exclusion_spec: input.exclusionSpec ?? {},
      template_id: input.templateId ?? null,
      title_template: input.titleTemplate?.trim() || null,
      body_template: input.bodyTemplate?.trim() || null,
      category: input.category,
      priority: input.priority,
      action_type: input.actionType ?? "open_screen",
      action_params: input.actionParams ?? {},
      throttle_minutes: input.throttleMinutes ?? 60,
      cooldown_minutes: input.cooldownMinutes ?? 1440,
      max_retries: input.maxRetries ?? 3,
      status: "draft",
      created_by: session.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "save_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "notification_automation",
    entityId: data.id,
    routeName: "notifications/automations",
    context: { name: input.name, trigger: input.triggerType },
  });
  return { id: data.id };
}

export async function updateNotificationAutomation(
  id: string,
  input: SaveAutomationInput,
): Promise<{ id: string } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim()) return { error: "invalid_input" };

  const supabase = await notificationsDb();
  const { data, error } = await supabase
    .from("notification_automations")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig ?? {},
      condition_spec: input.conditionSpec ?? {},
      target_spec: input.targetSpec ?? { mode: "all" },
      exclusion_spec: input.exclusionSpec ?? {},
      template_id: input.templateId ?? null,
      title_template: input.titleTemplate?.trim() || null,
      body_template: input.bodyTemplate?.trim() || null,
      category: input.category,
      priority: input.priority,
      action_type: input.actionType ?? "open_screen",
      action_params: input.actionParams ?? {},
      throttle_minutes: input.throttleMinutes ?? 60,
      cooldown_minutes: input.cooldownMinutes ?? 1440,
      max_retries: input.maxRetries ?? 3,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .neq("status", "archived")
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "not_found" };

  await logAdminMutation({
    action: "update",
    entityType: "notification_automation",
    entityId: id,
    routeName: "notifications/automations",
    context: { name: input.name },
  });
  return { id: data.id };
}

export async function setNotificationAutomationStatus(
  id: string,
  status: "active" | "paused" | "archived" | "draft",
): Promise<{ ok: true } | { error: NotificationActionError }> {
  const session = await requireNotificationsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = await notificationsDb();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "active") {
    patch.next_run_at = new Date().toISOString();
  }
  if (status === "paused" || status === "draft") {
    patch.next_run_at = null;
  }

  const { error } = await supabase.from("notification_automations").update(patch).eq("id", id);
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "update",
    entityType: "notification_automation",
    entityId: id,
    routeName: "notifications/automations",
    context: { status },
  });
  return { ok: true };
}

export async function listNotificationDispatchHistory(
  campaignId?: string,
): Promise<Array<Record<string, unknown>>> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  let query = supabase
    .from("notification_dispatch_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getNotificationRemoteConfig(): Promise<Record<string, unknown>> {
  await requireNotificationsView();
  const supabase = await notificationsDb();
  const { data } = await supabase
    .from("notification_remote_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (
    data ?? {
      id: 1,
      global_enabled: true,
      emergency_gate_enabled: true,
      category_throttles: {},
    }
  );
}

export async function processDueNotificationCampaigns(): Promise<{
  processed: number;
  errors: string[];
}> {
  const service = notificationsAdminDb();
  const now = new Date().toISOString();
  const { data: due } = await service
    .from("notification_campaigns")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_for", now)
    .limit(20);

  let processed = 0;
  const errors: string[] = [];
  for (const row of due ?? []) {
    const result = await executeNotificationDispatch(row.id, null);
    if ("error" in result) errors.push(`${row.id}:${result.error}`);
    else processed += 1;
  }
  return { processed, errors };
}

export async function createNotificationAutomation(input: {
  name: string;
  triggerKey: string;
  cooldownSeconds?: number;
  throttlePerHour?: number;
  maxRetries?: number;
}): Promise<{ id: string } | { error: NotificationActionError }> {
  return saveNotificationAutomation({
    name: input.name,
    triggerType: input.triggerKey as SaveAutomationInput["triggerType"],
    category: "reminder",
    priority: "normal",
    cooldownMinutes: Math.ceil((input.cooldownSeconds ?? 900) / 60),
    throttleMinutes: Math.max(1, Math.ceil(60 / Math.max(input.throttlePerHour ?? 100, 1))),
    maxRetries: input.maxRetries ?? 3,
  });
}

export async function createNotificationTemplate(input: {
  key: string;
  name: string;
  category: string;
  titleTemplate: string;
  bodyTemplate: string;
}): Promise<{ template: { key: string; id: string } } | { error: NotificationActionError }> {
  const result = await saveNotificationTemplate({
    name: input.name,
    category: input.category as SaveTemplateInput["category"],
    priority: "normal",
    titleTemplate: input.titleTemplate,
    bodyTemplate: input.bodyTemplate,
    actionType: "open_screen",
  });
  if ("error" in result) return result;
  return { template: { key: input.key || input.name, id: result.id } };
}

export async function runNotificationWorkerNow(
  _limit?: number,
): Promise<
  | { processed: number; failed: number; provider: string }
  | { error: NotificationActionError }
> {
  const session = await requireNotificationsSend();
  if (!session) return { error: "not_authorized" };
  const result = await processDueNotificationCampaigns();
  return {
    processed: result.processed,
    failed: result.errors.length,
    provider: "firebase_fcm",
  };
}

export async function enqueueNotificationAutomationEvent(input: {
  triggerType: SaveAutomationInput["triggerType"];
  driverId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ id: string } | { error: NotificationActionError }> {
  const service = notificationsAdminDb();
  const { data, error } = await service.rpc("enqueue_notification_automation_event", {
    p_trigger_type: input.triggerType,
    p_driver_id: input.driverId ?? null,
    p_payload: input.payload ?? {},
  });
  if (error) {
    console.error("[notifications] enqueue automation event failed:", error.message);
    return { error: "save_failed" };
  }
  return { id: String(data) };
}

function interpolateTemplateFromAutomation(template: string, vars: Record<string, string>): string {
  return interpolateTemplate(template, vars);
}

async function resolveAutomationContent(
  service: ReturnType<typeof notificationsAdminDb>,
  automation: NotificationAutomationRow,
  driverId?: string,
): Promise<{ title: string; body: string; actionType: string; actionParams: Record<string, unknown> } | null> {
  const vars: Record<string, string> = {
    driver_name: "Driver",
    driver_id: driverId ?? "",
  };
  if (automation.template_id) {
    const { data: tpl } = await service
      .from("notification_templates")
      .select("*")
      .eq("id", automation.template_id)
      .maybeSingle();
    if (!tpl) return null;
    return {
      title: interpolateTemplateFromAutomation(String(tpl.title_template ?? ""), vars),
      body: interpolateTemplateFromAutomation(String(tpl.body_template ?? ""), vars),
      actionType: tpl.action_type,
      actionParams: (tpl.action_params ?? {}) as Record<string, unknown>,
    };
  }
  if (!automation.title_template?.trim() || !automation.body_template?.trim()) return null;
  return {
    title: interpolateTemplateFromAutomation(automation.title_template, vars),
    body: interpolateTemplateFromAutomation(automation.body_template, vars),
    actionType: automation.action_type,
    actionParams: (automation.action_params ?? {}) as Record<string, unknown>,
  };
}

async function isDedupBlocked(
  service: ReturnType<typeof notificationsAdminDb>,
  automationId: string,
  driverId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  const dedupKey = `automation:${automationId}:driver:${driverId}`;
  const { data } = await service
    .from("notification_dedup_keys")
    .select("id")
    .eq("dedup_key", dedupKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (data) return true;
  await service.from("notification_dedup_keys").upsert(
    {
      dedup_key: dedupKey,
      automation_id: automationId,
      driver_id: driverId,
      expires_at: new Date(Date.now() + cooldownMinutes * 60_000).toISOString(),
    },
    { onConflict: "dedup_key" },
  );
  return false;
}

async function matchScheduledAutomationDrivers(
  service: ReturnType<typeof notificationsAdminDb>,
  automation: NotificationAutomationRow,
): Promise<string[]> {
  const config = automation.trigger_config ?? {};
  const trigger = automation.trigger_type;

  if (trigger === "inactivity") {
    const days = Number(config.inactivity_days ?? 7);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data: recent } = await service
      .from("deliveries")
      .select("driver_id")
      .gte("created_at", since);
    const activeSet = new Set(
      (recent ?? []).map((r: { driver_id: string }) => r.driver_id),
    );
    const { data: allDrivers } = await service
      .from("drivers")
      .select("id")
      .is("archived_at", null);
    return (allDrivers ?? [])
      .map((r: { id: string }) => r.id)
      .filter((id: string) => !activeSet.has(id));
  }

  if (trigger === "document_expiry") {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await service
      .from("document_tracking")
      .select("driver_id, doc_type, expires_at, notify_lead_days")
      .eq("track_expiry", true)
      .eq("notify_enabled", true)
      .not("driver_id", "is", null)
      .not("expires_at", "is", null);

    const driverIds = new Set<string>();
    for (const row of data ?? []) {
      const expiresAt = String(row.expires_at ?? "").slice(0, 10);
      if (!expiresAt) continue;
      const leadDays = (row.notify_lead_days ?? []) as number[];
      const daysUntil = Math.round(
        (new Date(`${expiresAt}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
          86_400_000,
      );
      if (leadDays.includes(daysUntil)) {
        driverIds.add(row.driver_id as string);
      }
    }
    return [...driverIds];
  }

  if (trigger === "low_performance") {
    const minDeliveries = Number(config.min_deliveries ?? 5);
    const periodDays = Number(config.period_days ?? 7);
    const since = new Date(Date.now() - periodDays * 86_400_000).toISOString();
    const { data: counts } = await service
      .from("deliveries")
      .select("driver_id")
      .gte("created_at", since)
      .eq("status", "verified");
    const byDriver = new Map<string, number>();
    for (const row of counts ?? []) {
      const id = (row as { driver_id: string }).driver_id;
      byDriver.set(id, (byDriver.get(id) ?? 0) + 1);
    }
    return [...byDriver.entries()].filter(([, c]) => c < minDeliveries).map(([id]) => id);
  }

  if (trigger === "shift_reminder" || trigger === "schedule") {
    const { data: audienceIds } = await service.rpc("compile_notification_audience_ids", {
      p_target_spec: automation.target_spec ?? { mode: "all" },
      p_exclusion_spec: automation.exclusion_spec ?? {},
    });
    return (audienceIds ?? []) as string[];
  }

  return [];
}

async function filterAudience(
  service: ReturnType<typeof notificationsAdminDb>,
  automation: NotificationAutomationRow,
  candidateIds: string[],
): Promise<string[]> {
  const { data: audienceIds } = await service.rpc("compile_notification_audience_ids", {
    p_target_spec: automation.target_spec ?? { mode: "all" },
    p_exclusion_spec: automation.exclusion_spec ?? {},
  });
  const allowed = new Set((audienceIds ?? []) as string[]);
  return candidateIds.filter((id) => allowed.has(id));
}

async function runAutomationForDrivers(
  service: ReturnType<typeof notificationsAdminDb>,
  automation: NotificationAutomationRow,
  driverIds: string[],
): Promise<{ matched: number; sent: number; failed: number; campaignId: string | null }> {
  if (driverIds.length === 0) {
    return { matched: 0, sent: 0, failed: 0, campaignId: null };
  }

  const content = await resolveAutomationContent(service, automation);
  if (!content) {
    return { matched: driverIds.length, sent: 0, failed: driverIds.length, campaignId: null };
  }

  const eligible: string[] = [];
  for (const driverId of driverIds) {
    const blocked = await isDedupBlocked(
      service,
      automation.id,
      driverId,
      automation.cooldown_minutes,
    );
    if (!blocked) eligible.push(driverId);
  }
  if (eligible.length === 0) {
    return { matched: driverIds.length, sent: 0, failed: 0, campaignId: null };
  }

  let templateScreenshot = false;
  if (automation.template_id) {
    const { data: templateRow } = await service
      .from("notification_templates")
      .select("screenshot_restricted")
      .eq("id", automation.template_id)
      .maybeSingle();
    templateScreenshot = Boolean(templateRow?.screenshot_restricted);
  }
  const screenshotRestricted = resolveScreenshotRestricted(null, templateScreenshot);

  const targetSpec: TargetSpec = { mode: "custom", driver_ids: eligible };
  const { data: campaign, error: campaignError } = await service
    .from("notification_campaigns")
    .insert({
      title: content.title,
      body: content.body,
      category: automation.category,
      priority: automation.priority,
      template_id: automation.template_id,
      target_spec: targetSpec,
      exclusion_spec: automation.exclusion_spec ?? {},
      action_type: content.actionType,
      action_params: content.actionParams,
      payload_version: PAYLOAD_VERSION,
      media: [],
      schedule_spec: { mode: "now" },
      timezone: KUWAIT_TZ,
      requires_approval: false,
      estimated_audience_count: eligible.length,
      screenshot_restricted_override: null,
      screenshot_restricted: screenshotRestricted,
      status: "queued",
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (campaignError || !campaign) {
    return { matched: driverIds.length, sent: 0, failed: eligible.length, campaignId: null };
  }

  const dispatch = await executeNotificationDispatch(campaign.id, null);
  if ("error" in dispatch) {
    return {
      matched: driverIds.length,
      sent: 0,
      failed: eligible.length,
      campaignId: campaign.id,
    };
  }
  return {
    matched: driverIds.length,
    sent: dispatch.sent,
    failed: dispatch.failed,
    campaignId: campaign.id,
  };
}

async function processAutomationRow(
  service: ReturnType<typeof notificationsAdminDb>,
  automation: NotificationAutomationRow,
  forcedDriverIds?: string[],
): Promise<void> {
  const { data: run } = await service
    .from("notification_automation_runs")
    .insert({
      automation_id: automation.id,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  let matched = 0;
  let sent = 0;
  let failed = 0;
  let campaignId: string | null = null;
  let errorSummary: string | null = null;

  try {
    const candidates =
      forcedDriverIds ??
      (await matchScheduledAutomationDrivers(service, automation));
    const driverIds = await filterAudience(service, automation, candidates);
    matched = driverIds.length;
    const result = await runAutomationForDrivers(service, automation, driverIds);
    sent = result.sent;
    failed = result.failed;
    campaignId = result.campaignId;
  } catch (e) {
    errorSummary = e instanceof Error ? e.message : "automation_failed";
  }

  if (run?.id) {
    await service
      .from("notification_automation_runs")
      .update({
        status: errorSummary ? "failed" : "completed",
        matched_count: matched,
        sent_count: sent,
        failed_count: failed,
        campaign_id: campaignId,
        error_summary: errorSummary,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  }

  const nextRun = new Date(Date.now() + automation.throttle_minutes * 60_000).toISOString();
  await service
    .from("notification_automations")
    .update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRun,
      updated_at: new Date().toISOString(),
    })
    .eq("id", automation.id);
}

export async function processDueAutomations(): Promise<{
  processed: number;
  eventsProcessed: number;
  errors: string[];
}> {
  const service = notificationsAdminDb();
  const now = new Date().toISOString();
  let processed = 0;
  let eventsProcessed = 0;
  const errors: string[] = [];

  const { data: dueAutomations } = await service
    .from("notification_automations")
    .select("*")
    .eq("status", "active")
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .limit(10);

  for (const automation of (dueAutomations ?? []) as NotificationAutomationRow[]) {
    if (["attendance_approved", "salary_processed", "incentive_unlocked", "missed_submission"].includes(
      automation.trigger_type,
    )) {
      continue;
    }
    try {
      await processAutomationRow(service, automation);
      processed += 1;
    } catch (e) {
      errors.push(`${automation.id}:${e instanceof Error ? e.message : "failed"}`);
    }
  }

  const { data: pendingEvents } = await service
    .from("notification_automation_events")
    .select("*")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  for (const event of pendingEvents ?? []) {
    const triggerType = event.trigger_type as SaveAutomationInput["triggerType"];
    const driverId = event.driver_id as string | null;
    const { data: automations } = await service
      .from("notification_automations")
      .select("*")
      .eq("status", "active")
      .eq("trigger_type", triggerType);

    for (const automation of (automations ?? []) as NotificationAutomationRow[]) {
      try {
        const candidates = driverId ? [driverId] : [];
        const driverIds = await filterAudience(service, automation, candidates);
        if (driverIds.length === 0) continue;
        await processAutomationRow(service, automation, driverIds);
        processed += 1;
      } catch (e) {
        errors.push(`${automation.id}:${e instanceof Error ? e.message : "event_failed"}`);
      }
    }

    await service
      .from("notification_automation_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
    eventsProcessed += 1;
  }

  return { processed, eventsProcessed, errors };
}
