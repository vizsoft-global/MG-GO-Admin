import { resolveFirebaseAdminCredentials } from "./credentials";

export type FirebaseServerEnv = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type NotificationRuntimeConfig = {
  approvalRequiredCategories: Set<string>;
  sendRatePerMinute: number;
  batchSize: number;
};

let cachedFirebaseEnv: FirebaseServerEnv | null = null;
let cachedRuntimeConfig: NotificationRuntimeConfig | null = null;

export function invalidateFirebaseEnvCache(): void {
  cachedFirebaseEnv = null;
  cachedRuntimeConfig = null;
}

export function resolveFirebaseServerEnv(): FirebaseServerEnv {
  if (cachedFirebaseEnv) return cachedFirebaseEnv;

  const config = resolveFirebaseAdminCredentials();
  if (!config) {
    throw new Error(
      "Firebase server env missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
    );
  }

  cachedFirebaseEnv = config;
  return cachedFirebaseEnv;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveNotificationRuntimeConfig(): NotificationRuntimeConfig {
  if (cachedRuntimeConfig) return cachedRuntimeConfig;

  const categoriesRaw =
    process.env.NOTIFICATION_APPROVAL_REQUIRED_CATEGORIES ??
    "emergency,broadcast";

  cachedRuntimeConfig = {
    approvalRequiredCategories: new Set(
      categoriesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
    sendRatePerMinute: parsePositiveInt(
      process.env.NOTIFICATION_SEND_RATE_PER_MINUTE,
      600,
    ),
    batchSize: parsePositiveInt(process.env.NOTIFICATION_BATCH_SIZE, 500),
  };
  return cachedRuntimeConfig;
}
