import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type FunctionsR2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
};

let client: S3Client | null = null;
let clientKey: string | null = null;

export function r2ConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FunctionsR2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) return null;
  const endpoint =
    env.R2_S3_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  return { accessKeyId, secretAccessKey, bucketName, endpoint };
}

function clientFor(config: FunctionsR2Config): S3Client {
  const key = `${config.endpoint}:${config.accessKeyId}:${config.bucketName}`;
  if (client && clientKey === key) return client;
  client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  clientKey = key;
  return client;
}

export function resetR2EsignClient(): void {
  client = null;
  clientKey = null;
}

function isMissingObject(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
}

export async function headR2Object(key: string): Promise<{ exists: boolean; size: number }> {
  const config = r2ConfigFromEnv();
  if (!config) throw new Error("r2 is not configured");
  try {
    const res = await clientFor(config).send(
      new HeadObjectCommand({ Bucket: config.bucketName, Key: key }),
    );
    return { exists: true, size: Number(res.ContentLength ?? 0) };
  } catch (error) {
    if (isMissingObject(error)) return { exists: false, size: 0 };
    throw error;
  }
}

export async function getR2ObjectBytes(key: string): Promise<Buffer | null> {
  const config = r2ConfigFromEnv();
  if (!config) throw new Error("r2 is not configured");
  try {
    const res = await clientFor(config).send(
      new GetObjectCommand({ Bucket: config.bucketName, Key: key }),
    );
    if (!res.Body) return null;
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

export async function putR2Object(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const config = r2ConfigFromEnv();
  if (!config) throw new Error("r2 is not configured");
  await clientFor(config).send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Presigned R2 PUT for a rider upload (QA #28).
 *
 * The project has no GCS bucket any more — the storage migration moved rider
 * objects to R2 — so the old `getSignedUrl` on `storage.bucket()` always failed
 * and every fuel photo reported `upload_failed`. These two helpers hand the app
 * the same short-lived URL shape it already PUTs to, with no app change.
 */
export async function presignR2Put(
  key: string,
  contentType: string,
  expiresInSeconds: number,
): Promise<string> {
  const config = r2ConfigFromEnv();
  if (!config) throw new Error("r2 is not configured");
  return getSignedUrl(
    clientFor(config),
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function presignR2Get(
  key: string,
  expiresInSeconds: number,
): Promise<string> {
  const config = r2ConfigFromEnv();
  if (!config) throw new Error("r2 is not configured");
  return getSignedUrl(
    clientFor(config),
    new GetObjectCommand({ Bucket: config.bucketName, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
