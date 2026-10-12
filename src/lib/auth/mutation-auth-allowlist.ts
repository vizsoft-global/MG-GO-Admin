export type MutationAuthAllow = {
  file: string;
  fn: string;
  reason: string;
};

/**
 * Write functions that must not call requireMutationAuth.
 * `fn: "*"` covers every write function in that file (or directory when the
 * file ends with `/**`).
 */
export const MUTATION_AUTH_ALLOWLIST: MutationAuthAllow[] = [
  {
    file: "src/app/api/driver-app/**",
    fn: "*",
    reason: "driver bearer token, not a staff session cookie",
  },
  {
    file: "src/app/api/notifications/events/route.ts",
    fn: "*",
    reason: "client/device event ingest, not a staff session",
  },
  {
    file: "src/features/auth/actions.ts",
    fn: "signInWithEmail",
    reason: "no staff mutation session yet",
  },
  {
    file: "src/features/auth/actions.ts",
    fn: "signUp",
    reason: "no staff mutation session yet",
  },
  {
    file: "src/features/auth/actions.ts",
    fn: "requestPasswordReset",
    reason: "no staff mutation session yet",
  },
  {
    file: "src/features/auth/actions.ts",
    fn: "establishSession",
    reason: "no staff mutation session yet",
  },
  {
    file: "src/features/auth/actions.ts",
    fn: "signOut",
    reason: "sign-out clears only the session cookie",
  },
  {
    file: "src/features/notifications/notifications-actions.ts",
    fn: "processDueAutomations",
    reason: "Vercel cron via CRON_SECRET, not a staff session cookie",
  },
  {
    file: "src/features/notifications/notifications-actions.ts",
    fn: "processAutomationRow",
    reason: "Vercel cron via CRON_SECRET, not a staff session cookie",
  },
  {
    file: "src/features/notifications/notifications-actions.ts",
    fn: "runAutomationForDrivers",
    reason: "Vercel cron via CRON_SECRET, not a staff session cookie",
  },
  {
    file: "src/features/notifications/notifications-actions.ts",
    fn: "isDedupBlocked",
    reason: "Vercel cron via CRON_SECRET, not a staff session cookie",
  },
  {
    file: "src/features/notifications/notifications-actions.ts",
    fn: "executeNotificationDispatch",
    reason:
      "shared by the notifications-dispatch cron and the automation cron (CRON_SECRET). Staff entries dispatchNotificationCampaign, sendDirectDriverNotification, and runNotificationWorkerNow call requireMutationAuth",
  },
  {
    file: "src/features/esign/esign-sender-actions.ts",
    fn: "patchDoc",
    reason:
      "esign-batch-drain cron calls runEsignBatchChunk with asWorker true and no staff cookie. Staff calls gate inside runEsignBatchChunk when asWorker is false",
  },
];

export function mutationAuthAllowReason(file: string, fn: string): string | null {
  for (const row of MUTATION_AUTH_ALLOWLIST) {
    const fileMatch = row.file.endsWith("/**")
      ? file.startsWith(row.file.slice(0, -2))
      : row.file === file;
    if (!fileMatch) continue;
    if (row.fn === "*" || row.fn === fn) return row.reason;
  }
  return null;
}
