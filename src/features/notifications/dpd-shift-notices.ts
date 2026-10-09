import "server-only";

import type { DocumentData, Firestore } from "firebase-admin/firestore";

import { callCronFunction } from "@/lib/firebase/callable";
import { staffDb } from "@/lib/firebase/staff-db";
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

type Loose = Record<string, unknown>;

function fromValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(fromValue);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Loose = {};
    for (const [key, inner] of Object.entries(value as Loose)) out[key] = fromValue(inner);
    return out;
  }
  return value;
}

function fromDoc(id: string, data: DocumentData | undefined): Loose {
  const out: Loose = { id };
  for (const [key, value] of Object.entries(data ?? {})) out[key] = fromValue(value);
  if (data?.id != null) out.id = fromValue(data.id) as string;
  return out;
}

async function noticeDocs(
  db: Firestore,
  driverId: string,
  shiftDate: string,
  kind: string,
): Promise<Array<{ id: string }>> {
  try {
    const snap = await db
      .collection("driver_dpd_shift_notices")
      .where("driver_id", "==", driverId)
      .where("shift_date", "==", shiftDate)
      .where("kind", "==", kind)
      .get();
    return snap.docs.map((doc) => ({ id: doc.id }));
  } catch {
    const snap = await db
      .collection("driver_dpd_shift_notices")
      .where("driver_id", "==", driverId)
      .get();
    return snap.docs
      .map((doc) => fromDoc(doc.id, doc.data()))
      .filter((row) => row.shift_date === shiftDate && row.kind === kind)
      .map((row) => ({ id: String(row.id) }));
  }
}

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
  const { data, error } = await callCronFunction<DpdNoticeCandidate[] | null>(
    "admin_dpd_notice_candidates",
    {
      p_now: (options.now ?? new Date()).toISOString(),
      p_driver_ids: options.driverIds?.length ? options.driverIds : null,
      p_kinds: options.kinds?.length ? options.kinds : null,
    },
  );
  if (error) throw new Error(error.message);

  const candidates = data ?? [];
  const result: DpdNoticeRunResult = {
    candidates: candidates.length,
    sent: 0,
    pushed: 0,
    failed: 0,
  };
  const pushes: Array<{
    driverId: string;
    title: string;
    body: string;
    campaignId: string;
    dispatchItemId: string | null;
    priority: "high" | "normal";
    params: Record<string, string>;
  }> = [];

  for (const candidate of candidates) {
    const { data: claimed, error: claimError } = await callCronFunction<boolean>(
      "claim_dpd_shift_notice",
      {
        p_driver_id: candidate.driver_id,
        p_shift_date: candidate.shift_date,
        p_kind: candidate.kind,
      },
    );
    if (claimError) {
      result.failed += 1;
      continue;
    }
    if (claimed !== true) continue;

    const message = buildDpdNoticeMessage(candidate);
    const noticePriority = candidate.kind === "warning" ? "high" : "normal";
    const params = {
      record_type: "dpd_target",
      kind: candidate.kind,
      shift_date: candidate.shift_date,
      screen: "home",
      route: "/home",
    };
    const { data: sent, error: notifyError } = await callCronFunction<{
      ok?: boolean;
      campaign_id?: string;
      dispatch_item_id?: string;
    } | null>("notify_driver_transactional", {
      p_driver_id: candidate.driver_id,
      p_title: message.title,
      p_body: message.body,
      p_deep_link: "musallam:///home",
      p_category: "incentive",
      p_priority: noticePriority,
      p_action_params: params,
    });
    const payload = sent ?? {};
    if (notifyError || payload.ok !== true || !payload.campaign_id) {
      const db = await staffDb();
      if (!db) {
        result.failed += 1;
        continue;
      }
      const docs = await noticeDocs(db, candidate.driver_id, candidate.shift_date, candidate.kind);
      const batch = db.batch();
      for (const doc of docs) batch.delete(db.collection("driver_dpd_shift_notices").doc(doc.id));
      if (docs.length > 0) await batch.commit();
      result.failed += 1;
      continue;
    }

    const db = await staffDb();
    if (db) {
      const docs = await noticeDocs(db, candidate.driver_id, candidate.shift_date, candidate.kind);
      const batch = db.batch();
      for (const doc of docs) {
        batch.update(db.collection("driver_dpd_shift_notices").doc(doc.id), {
          campaign_id: payload.campaign_id,
        });
      }
      if (docs.length > 0) await batch.commit();
    }
    result.sent += 1;
    pushes.push({
      driverId: candidate.driver_id,
      title: message.title,
      body: message.body,
      campaignId: payload.campaign_id,
      dispatchItemId: payload.dispatch_item_id ?? null,
      priority: noticePriority,
      params,
    });
  }

  if (pushes.length === 0) return result;

  try {
    const db = await staffDb();
    const driverIds = [...new Set(pushes.map((push) => push.driverId))];
    const tokens: Array<{
      id: string;
      driver_id: string;
      token: string;
      last_seen_at: string | null;
    }> = [];
    if (db) {
      for (let i = 0; i < driverIds.length; i += 30) {
        const chunk = driverIds.slice(i, i + 30);
        if (chunk.length === 0) continue;
        let snap;
        try {
          snap = await db
            .collection("driver_push_tokens")
            .where("driver_id", "in", chunk)
            .where("is_active", "==", true)
            .get();
        } catch {
          snap = await db.collection("driver_push_tokens").where("driver_id", "in", chunk).get();
        }
        for (const doc of snap.docs) {
          const row = fromDoc(doc.id, doc.data());
          if (row.is_active !== true) continue;
          tokens.push({
            id: String(row.id),
            driver_id: String(row.driver_id ?? ""),
            token: String(row.token ?? ""),
            last_seen_at: (row.last_seen_at as string | null) ?? null,
          });
        }
      }
    }
    const byDriver = pickLatestPushTokenByDriver(tokens);
    const messages: PushMessageInput[] = [];
    for (const push of pushes) {
      const token = byDriver.get(push.driverId);
      if (!token) continue;
      const action = buildActionPayload({
        actionType: "open_record",
        actionParams: push.params,
        deepLink: "musallam:///home",
        campaignId: push.campaignId,
      });
      messages.push({
        token: token.token,
        title: push.title,
        body: push.body,
        data: buildFcmDataPayload({
          campaignId: push.campaignId,
          dispatchItemId: push.dispatchItemId,
          action,
          category: "incentive",
          priority: push.priority,
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
