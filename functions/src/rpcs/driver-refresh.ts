/**
 * The silent "Home changed" signal.
 *
 * Home refreshes because the data changed, not because a timer fired. The
 * envelope is the one the rider app already understands —
 * `action_params.record_type` — with a new value, `home`, and **no
 * `notification` block**, so FCM never paints a tray item. An app build that
 * does not know the value ignores it, which is why the server half of the
 * event-driven refresh ships before the Play release.
 *
 * A push failure is never a caller error: every writer uses this after its own
 * commit, and the next event (or the `drivers/{uid}` watcher) is the retry.
 */
import { getMessaging } from "firebase-admin/messaging";
import { loadActivePushTokens, pickLatestActivePushToken } from "./driver-push-tokens";

export const HOME_REFRESH_RECORD_TYPE = "home";

/** The exact data payload the rider app's refresh handler reads. */
export function homeRefreshData(reason: string): Record<string, string> {
  return {
    payload_version: "2",
    action_type: "open_record",
    action_params: JSON.stringify({ record_type: HOME_REFRESH_RECORD_TYPE, reason }),
    category: "system",
    priority: "low",
    screenshot_restricted: "0",
  };
}

/**
 * Send the data-only refresh to a rider's newest active token.
 *
 * Returns `true` only when FCM accepted the message. Callers ignore the value;
 * it exists so a test can assert the send happened.
 */
export async function sendDriverHomeRefresh(
  driverId: string,
  reason = "duty",
): Promise<boolean> {
  try {
    const tokens = await loadActivePushTokens(driverId);
    const latest = pickLatestActivePushToken(tokens);
    if (!latest) return false;
    await getMessaging().send({
      token: latest.token,
      data: homeRefreshData(reason),
      android: { priority: "high" },
      apns: {
        headers: { "apns-push-type": "background", "apns-priority": "5" },
        payload: { aps: { "content-available": 1 } },
      },
    });
    return true;
  } catch {
    return false;
  }
}
