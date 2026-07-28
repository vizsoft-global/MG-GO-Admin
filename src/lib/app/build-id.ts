export const DEV_BUILD_ID = "development";

/**
 * Bump on each admin release so open tabs always see a build-id change after deploy,
 * even when Vercel reuses the same git commit SHA.
 */
export const APP_PANEL_VERSION = "0.1.1";

/**
 * Build / deployment identity for the update-required gate.
 * Client bundle inlines the value from next.config at build time; /api/build-id
 * must return the live deployment fingerprint so stale tabs get the refresh prompt.
 */
export function resolveBuildId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "development") {
    return DEV_BUILD_ID;
  }

  const fingerprint =
    env.VERCEL_DEPLOYMENT_ID ??
    env.VERCEL_GIT_COMMIT_SHA ??
    "unknown";

  return `${APP_PANEL_VERSION}:${fingerprint}`;
}

/** Server-only: never fall back to NEXT_PUBLIC_BUILD_ID (stale tabs already carry that). */
export function resolveLiveBuildId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "development") {
    return DEV_BUILD_ID;
  }

  const fingerprint =
    env.VERCEL_DEPLOYMENT_ID ??
    env.VERCEL_GIT_COMMIT_SHA ??
    "unknown";

  return `${APP_PANEL_VERSION}:${fingerprint}`;
}
