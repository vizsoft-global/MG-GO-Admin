export type R2RuntimeConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  source: "env";
};

let cached: R2RuntimeConfig | null = null;

export function invalidateR2ConfigCache(): void {
  cached = null;
}

function configFromEnv(): R2RuntimeConfig | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }
  const endpoint =
    process.env.R2_S3_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint,
    source: "env",
  };
}

export async function resolveR2Config(): Promise<R2RuntimeConfig> {
  if (cached) return cached;

  const fromEnv = configFromEnv();
  if (!fromEnv) {
    throw new Error(
      "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in server environment variables.",
    );
  }

  cached = fromEnv;
  return fromEnv;
}

export async function isR2Configured(): Promise<boolean> {
  try {
    await resolveR2Config();
    return true;
  } catch {
    return false;
  }
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
