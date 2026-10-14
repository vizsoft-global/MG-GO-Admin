import { getObjectBytes, headObject, putObject } from "@/lib/storage/r2-client";
import { isR2Configured } from "@/lib/storage/r2-config";
import {
  esignR2WorkerConfig,
  getViaEsignWorker,
  headViaEsignWorker,
  putViaEsignWorker,
} from "@/lib/storage/esign-r2-worker";
import { esignObjectPath } from "./esign-storage-key";
import { classifyEsignUploadError } from "./esign-upload-error";

export async function isEsignStorageConfigured(): Promise<boolean> {
  if (await isR2Configured()) return true;
  return esignR2WorkerConfig() != null;
}

export async function putEsignObject(
  key: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
  options?: { rejectIfExists?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const path = esignObjectPath(key);
  const body = Buffer.from(bytes);
  const worker = esignR2WorkerConfig();
  try {
    if (await isR2Configured()) {
      try {
        if (options?.rejectIfExists) {
          const existing = await headObject(path);
          if (existing.exists) return { ok: false, error: "already_exists" };
        }
        await putObject(path, body, contentType, {
          entityType: "esign",
          uploadedVia: "admin",
        });
        return { ok: true };
      } catch (s3Error) {
        if (!worker) throw s3Error;
      }
    }
    if (!worker) return { ok: false, error: "not_configured" };
    if (options?.rejectIfExists) {
      const existing = await headViaEsignWorker(worker, path);
      if (existing.exists) return { ok: false, error: "already_exists" };
    }
    await putViaEsignWorker(worker, path, body, contentType);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: classifyEsignUploadError(e) };
  }
}

export async function readEsignObject(
  key: string,
): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  const path = esignObjectPath(key);
  if (await isR2Configured()) {
    try {
      return await getObjectBytes(path);
    } catch {
      // Preview often has broken S3 placeholders; Worker binding still serves the folder.
    }
  }
  const worker = esignR2WorkerConfig();
  if (!worker) return null;
  return getViaEsignWorker(worker, path);
}
