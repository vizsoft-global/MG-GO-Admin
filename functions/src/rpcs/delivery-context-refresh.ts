/**
 * `adminRefreshDeliveryContext` — the caller the panel uses after a direct write.
 *
 * The admin app saves settings, restaurants, geofences and zones straight through
 * the Admin SDK, so a Cloud Functions write hook never sees those rows. Each of
 * those server actions calls this after the row commits, which is what makes
 * "push inline on write" cover the panel's own path.
 *
 * The callable deliberately returns `success` even when the rebuild failed:
 * the panel's write already committed, and the sweep repairs a missed refresh.
 */
import "../core/init";
import { onCall } from "firebase-functions/v2/https";
import { requireStaffAny } from "../core/staff";
import { rebuildDeliveryContextSafe } from "./delivery-context-build";

/** Any of the three modules that own a field the gate reads may ask for a rebuild. */
const REFRESH_SLUGS = ["settings.manage", "restaurants.manage", "zones.manage"] as const;

export const adminRefreshDeliveryContext = onCall(async (request) => {
  await requireStaffAny(request, REFRESH_SLUGS);
  await rebuildDeliveryContextSafe("admin_refresh");
  return { success: true };
});
