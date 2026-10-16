"use server";

import { revalidatePath, updateTag } from "next/cache";
import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { writeWithEpochCounters } from "@/lib/auth/auth-epochs";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  parseDriverPayPlan,
  payPlanToFirestore,
  validatePayPlan,
  type DriverPayPlan,
  type PayPlanIssue,
} from "./driver-pay-plan";

/** Stored on the single app_settings document, snake_case, under `driver_pay_plan`. */
const PAY_PLAN_FIELD = "driver_pay_plan";

export type LoadPayPlanResult =
  | { plan: DriverPayPlan }
  | { error: "not_authorized" | "not_configured" };

export type SavePayPlanResult =
  | { success: true; plan: DriverPayPlan }
  | {
      error: PayPlanIssue | "not_authorized" | "not_configured" | "save_failed";
      errorDetail?: string;
    };

/**
 * Read the stored plan. `parseDriverPayPlan` already falls back to
 * `DEFAULT_DRIVER_PAY_PLAN` for a missing or invalid stored value, so a document
 * that has never held a plan reads as the shipped one rather than as blank.
 */
export async function loadDriverPayPlan(): Promise<LoadPayPlanResult> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "payroll.view", session.isSuperAdmin)
  ) {
    return { error: "not_authorized" };
  }
  const db = await staffDb();
  if (!db) return { error: "not_configured" };
  try {
    const snap = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
    const raw = snap.data()?.[PAY_PLAN_FIELD];
    return { plan: parseDriverPayPlan(raw) };
  } catch {
    return { plan: parseDriverPayPlan(undefined) };
  }
}

/**
 * Validate, then merge `driver_pay_plan` onto app_settings and bump the settings
 * epoch. An invalid plan is refused with the specific issue from
 * `validatePayPlan` so the editor can name the band it must fix: overlap, gap,
 * threshold, open_end, rate or ladder.
 */
export async function saveDriverPayPlan(
  locale: string,
  plan: DriverPayPlan,
): Promise<SavePayPlanResult> {
  const auth = await requireMutationAuth("payroll.manage");
  if ("error" in auth) {
    return { error: auth.error === "not_configured" ? "not_configured" : "not_authorized" };
  }

  const issue = validatePayPlan(plan);
  if (issue) return { error: issue };

  // Validated above, then coerced through the same parser the reader uses, so a
  // stray non-number can never reach the document and what is written is what
  // will be read back.
  const stored = parseDriverPayPlan(payPlanToFirestore(plan));

  const db = await staffDb();
  if (!db) return { error: "not_configured" };

  const ref = db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID);
  const existing = await ref.get();
  if (!existing.exists) {
    return { error: "save_failed", errorDetail: "app_settings_missing" };
  }
  const before = parseDriverPayPlan(existing.data()?.[PAY_PLAN_FIELD]);

  try {
    await writeWithEpochCounters(db, "settings", ({ tx }) => {
      tx.set(
        ref,
        {
          [PAY_PLAN_FIELD]: payPlanToFirestore(stored),
          updated_at: new Date(),
          updated_by: auth.session.id,
        },
        { merge: true },
      );
    });
  } catch (error) {
    return {
      error: "save_failed",
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }

  updateTag("app-settings");
  revalidatePath(`/${locale}/payroll`, "layout");
  void logAdminMutation({
    action: "update",
    entityType: "app_settings",
    entityId: APP_SETTINGS_DOC_ID,
    routeName: "saveDriverPayPlan",
    before: payPlanToFirestore(before),
    after: payPlanToFirestore(stored),
  });

  return { success: true, plan: stored };
}
