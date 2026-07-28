import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { invalidateR2ConfigCache, resolveR2Config } from "@/lib/storage/r2-config";
import { recordStorageUpload } from "@/lib/storage/storage-upload-audit";
import type { StorageUploadVia } from "@/lib/storage/storage-upload-audit";

const DEFAULT_PRESIGN_SECONDS = 900;
const DEFAULT_PUT_PRESIGN_SECONDS = 300;

let client: S3Client | null = null;
let clientConfigKey: string | null = null;

function configKey(config: Awaited<ReturnType<typeof resolveR2Config>>): string {
  return `${config.endpoint}:${config.accessKeyId}:${config.bucketName}`;
}

export async function getR2Client(): Promise<S3Client> {
  const config = await resolveR2Config();
  const key = configKey(config);

  if (client && clientConfigKey === key) return client;

  client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  clientConfigKey = key;
  return client;
}

export async function getR2BucketName(): Promise<string> {
  const config = await resolveR2Config();
  return config.bucketName;
}

export async function testR2Connection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const s3 = await getR2Client();
    const bucket = await getR2BucketName();
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connection failed";
    return { ok: false, error: message };
  }
}

const PROBE_BODY = "DPD admin R2 probe";

export type R2ProbeStep = "bucket" | "write" | "read" | "delete";

export async function runR2StorageProbe(): Promise<{
  ok: boolean;
  key?: string;
  steps?: R2ProbeStep[];
  error?: string;
}> {
  const steps: R2ProbeStep[] = [];

  try {
    const s3 = await getR2Client();
    const bucket = await getR2BucketName();

    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    steps.push("bucket");

    const key = `healthcheck/dpd-admin-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;

    await putObject(key, Buffer.from(PROBE_BODY), "text/plain", {
      entityType: "healthcheck",
      uploadedVia: "admin",
    });
    steps.push("write");

    const getRes = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    const body = await getRes.Body?.transformToString();
    if (body !== PROBE_BODY) {
      return {
        ok: false,
        key,
        steps,
        error: "Probe read mismatch",
      };
    }
    steps.push("read");

    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    steps.push("delete");

    return { ok: true, key, steps };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Connection failed";
    return { ok: false, steps, error: message };
  }
}

export type PutObjectMeta = {
  uploadedBy?: string;
  entityType?: string;
  entityId?: string;
  uploadedVia?: "admin" | "driver_proxy";
};

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  meta?: PutObjectMeta,
): Promise<void> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const sizeBytes =
    body instanceof Buffer ? body.length : body.byteLength;

  void recordStorageUpload({
    objectKey: key,
    sizeBytes,
    contentType,
    entityType: meta?.entityType ?? null,
    entityId: meta?.entityId ?? null,
    uploadedBy: meta?.uploadedBy ?? null,
    uploadedVia: (meta?.uploadedVia ?? "admin") as StorageUploadVia,
    status: "completed",
  });
}

export async function headObject(key: string): Promise<{
  exists: boolean;
  size?: number;
  contentType?: string;
}> {
  try {
    const s3 = await getR2Client();
    const bucket = await getR2BucketName();
    const res = await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return {
      exists: true,
      size: res.ContentLength,
      contentType: res.ContentType,
    };
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      err.name === "NotFound" ||
      err.$metadata?.httpStatusCode === 404
    ) {
      return { exists: false };
    }
    throw e;
  }
}

export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = DEFAULT_PUT_PRESIGN_SECONDS,
): Promise<string> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function getUnsignedContentTypePutUrl(
  key: string,
  expiresInSeconds = DEFAULT_PUT_PRESIGN_SECONDS,
): Promise<string> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3, command, {
    expiresIn: expiresInSeconds,
    unhoistableHeaders: new Set<string>(),
    signableHeaders: new Set(["host"]),
  });
}

export async function deleteObject(key: string): Promise<void> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return;

  const s3 = await getR2Client();
  const bucket = await getR2BucketName();

  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
}

export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
  const bucket = await getR2BucketName();
  const s3 = await getR2Client();
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destKey,
    }),
  );
}

export async function getPresignedGetUrl(
  key: string,
  expiresInSeconds = DEFAULT_PRESIGN_SECONDS,
): Promise<string> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function applyBucketCors(allowedOrigins: string[]): Promise<void> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: allowedOrigins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
}

export { invalidateR2ConfigCache };
