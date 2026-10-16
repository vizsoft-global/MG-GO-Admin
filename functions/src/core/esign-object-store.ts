import { esignWorkerConfig, getEsignWorkerBytes, headEsignWorker, putEsignWorker } from "./esign-r2-worker";
import { getR2ObjectBytes, headR2Object, putR2Object, r2ConfigFromEnv } from "./r2-esign";

export function esignStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return r2ConfigFromEnv(env) != null || esignWorkerConfig(env) != null;
}

async function readS3(key: string): Promise<Buffer | null> {
  if (!r2ConfigFromEnv()) return null;
  return getR2ObjectBytes(key);
}

export async function readEsignStoredObject(key: string): Promise<Buffer | null> {
  if (r2ConfigFromEnv()) {
    try {
      const bytes = await readS3(key);
      if (bytes && bytes.length > 0) return bytes;
    } catch (error) {
      console.error("esign s3 read failed", error instanceof Error ? error.name : "error");
    }
  }
  const worker = esignWorkerConfig();
  if (!worker) return null;
  return getEsignWorkerBytes(worker, key);
}

export async function headEsignStoredObject(key: string): Promise<{ exists: boolean; size: number }> {
  if (r2ConfigFromEnv()) {
    try {
      const head = await headR2Object(key);
      if (head.exists) return head;
    } catch (error) {
      console.error("esign s3 head failed", error instanceof Error ? error.name : "error");
    }
  }
  const worker = esignWorkerConfig();
  if (!worker) return { exists: false, size: 0 };
  return headEsignWorker(worker, key);
}

export async function putEsignStoredObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (r2ConfigFromEnv()) {
    try {
      await putR2Object(key, body, contentType);
      return;
    } catch (error) {
      const worker = esignWorkerConfig();
      if (!worker) throw error;
      console.error("esign s3 put failed", error instanceof Error ? error.name : "error");
    }
  }
  const worker = esignWorkerConfig();
  if (!worker) throw new Error("r2 is not configured");
  await putEsignWorker(worker, key, body, contentType);
}
