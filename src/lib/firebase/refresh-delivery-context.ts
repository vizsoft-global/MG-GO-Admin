import "server-only";
import { callAdminFunction } from "./callable";

/**
 * Rebuilds `delivery_context_cache/current` after a panel write.
 *
 * The panel writes settings, zones, restaurants and geofences straight through
 * the Admin SDK, so the callable has no write hook to hang the rebuild on. Each
 * server action that changes one of those rows calls this once the write has
 * committed, which is what keeps the rider's proximity gate immediate instead of
 * waiting for `deliveryProximitySweep`.
 *
 * Best effort on purpose. The row is already saved, and a missed refresh is
 * repaired by the ten-minute sweep, so this never fails the operator's save.
 */
export async function refreshDeliveryContext(): Promise<void> {
  try {
    const { error } = await callAdminFunction<{ success: boolean }>(
      "adminRefreshDeliveryContext",
      {},
      { timeoutMs: 20_000 },
    );
    if (error) {
      console.warn(
        JSON.stringify({ event: "delivery_context_refresh_failed", error: error.message }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "delivery_context_refresh_failed",
        error: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}
