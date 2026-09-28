import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushBatch, type PushMessageInput } from "@/lib/firebase/fcm-provider";
import { buildActionPayload, buildFcmDataPayload } from "@/features/notifications/payload-contract";
import { pickLatestPushTokenByDriver } from "@/features/notifications/push-token-select";
import {
  buildDpdNoticeMessage,
  type DpdNoticeCandidate,
  type DpdNoticeKind,
} from "./dpd-shift-notice-messages";

export type DpdNoticeRunResult = {
  candidates: number;
  sent: number;
  pushed: number;
  failed: number;
};

/**
 * Sends the DPD shift messages (warning / congrats / summary). The ledger
 * claim in driver_dpd_shift_notices is what makes each kind at-most-once per
 * rider per shift day, so a cron run racing a verify hook cannot double-send.
 */
export async function dispatchDpdShiftNotices(options: {
  now?: Date;
  driverIds?: string[];
  kinds?: DpdNoticeKind[];
} = {}): Promise<DpdNoticeRunResult> {
  const admin = createAdminClient({ timeoutMs: 8000 }) as unknown as SupabaseClient;
  const { data, error } = await admin.rpc("admin_dpd_notice_candidates", {
    p_now: (options.now ?? new Date()).toISOString(),
    p_driver_ids: options.driverIds?.length ? options.driverIds : null,
    p_kinds: options.kinds?.length ? options.kinds : null,
  });
  if (error) throw error;

  const candidates = (data ?? []) as DpdNoticeCandidate[];
  const result: DpdNoticeRunResult = { candidates: candidates.length, sent: 0, pushed: 0, failed: 0 };
  const pushes: Array<{
    driverId: string;
    title: string;
    body: string;
    campaignId: string;
    dispatchItemId: string | null;
    params: Record<string, string>;
  }> = [];

  for (const c of candidates) {
    const { data: claimed, error: claimError } = await admin.rpc("claim_dpd_shift_notice", {
      p_driver_id: c.driver_id,
      p_shift_date: c.shift_date,
      p_kind: c.kind,
    });
    if (claimError) {
      result.failed += 1;
      continue;
    }
    if (claimed !== true) continue;

    const message = buildDpdNoticeMessage(c);
    const params = {
      record_type: "dpd_target",
      kind: c.kind,
      shift_date: c.shift_date,
      screen: "home",
      route: "/home",
    };
    const { data: sent, error: notifyError } = await admin.rpc("notify_driver_transactional", {
      p_driver_id: c.driver_id,
      p_title: message.title,
      p_body: message.body,
      p_deep_link: "musallam:///home",
      p_category: "incentive",
      p_priority: c.kind === "warning" ? "high" : "normal",
      p_action_params: params,
    });
    const payload = (sent ?? {}) as { ok?: boolean; campaign_id?: string; dispatch_item_id?: string };
    if (notifyError || payload.ok !== true || !payload.campaign_id) {
      // Release the claim so the next run can try again.
      await admin
        .from("driver_dpd_shift_notices")
        .delete()
        .eq("driver_id", c.driver_id)
        .eq("shift_date", c.shift_date)
        .eq("kind", c.kind);
      result.failed += 1;
      continue;
    }

    await admin
      .from("driver_dpd_shift_notices")
      .update({ campaign_id: payload.campaign_id })
      .eq("driver_id", c.driver_id)
      .eq("shift_date", c.shift_date)
      .eq("kind", c.kind);
    result.sent += 1;
    pushes.push({
      driverId: c.driver_id,
      title: message.title,
      body: message.body,
      campaignId: payload.campaign_id,
      dispatchItemId: payload.dispatch_item_id ?? null,
      params,
    });
  }

  if (pushes.length === 0) return result;

  try {
    const { data: tokens } = await admin
      .from("driver_push_tokens")
      .select("id, driver_id, token, last_seen_at")
      .in("driver_id", [...new Set(pushes.map((p) => p.driverId))])
      .eq("is_active", true);
    const byDriver = pickLatestPushTokenByDriver(
      (tokens ?? []) as Array<{ id: string; driver_id: string; token: string; last_seen_at: string | null }>,
    );
    const messages: PushMessageInput[] = [];
    for (const p of pushes) {
      const token = byDriver.get(p.driverId);
      if (!token) continue;
      const action = buildActionPayload({
        actionType: "open_record",
        actionParams: p.params,
        deepLink: "musallam:///home",
        campaignId: p.campaignId,
      });
      messages.push({
        token: token.token,
        title: p.title,
        body: p.body,
        data: buildFcmDataPayload({
          campaignId: p.campaignId,
          dispatchItemId: p.dispatchItemId,
          action,
          category: "incentive",
          priority: "normal",
        }),
      });
    }
    if (messages.length > 0) {
      const push = await sendPushBatch(messages);
      result.pushed = push.successCount;
    }
  } catch {
    // Inbox rows already exist; a dead FCM path must not fail the run.
  }
  return result;
}

/** Congratulations right after a verify; the cron is the fallback. Never throws. */
export async function sendDpdCongratsFor(driverIds: string[]): Promise<void> {
  const ids = [...new Set(driverIds.filter(Boolean))];
  if (ids.length === 0) return;
  try {
    await dispatchDpdShiftNotices({ driverIds: ids, kinds: ["congrats"] });
  } catch {
    // Verify already succeeded; the cron retries within five minutes.
  }
}
