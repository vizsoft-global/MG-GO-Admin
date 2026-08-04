/**
 * Single driver app release channel.
 * Beta / internal channels were removed with sideload OTA — Play Store only.
 */
export const APP_RELEASE_CHANNEL = "production" as const;

export type AppReleaseChannel = typeof APP_RELEASE_CHANNEL;
