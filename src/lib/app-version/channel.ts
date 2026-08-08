/**
 * Adoption-storage label only (DB / RPC compatibility).
 * Not a product update channel — sideload OTA and beta/internal channels were removed.
 * Driver updates ship via Google Play only.
 */
export const APP_RELEASE_CHANNEL = "production" as const;

export type AppReleaseChannel = typeof APP_RELEASE_CHANNEL;
