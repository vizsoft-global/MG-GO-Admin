export const DEFAULT_ESIGN_R2_WORKER_URL = "https://dpd-esign-r2.vizsoft.workers.dev";

export type EsignWorkerConfig = {
  url: string;
  secret: string;
};

export function esignWorkerConfig(env: NodeJS.ProcessEnv = process.env): EsignWorkerConfig | null {
  const url = (env.ESIGN_R2_WORKER_URL?.trim() || DEFAULT_ESIGN_R2_WORKER_URL).replace(/\/+$/, "");
  const secret = env.ESIGN_R2_WORKER_SECRET?.trim();
  if (!secret) return null;
  return { url, secret };
}

export function isAllowedEsignWorkerKey(key: string): boolean {
  return (
    key.startsWith("esign-documents/") &&
    !key.includes("..") &&
    !key.includes("\\") &&
    !key.includes("\0") &&
    key.length < 512
  );
}

function workerUrl(config: EsignWorkerConfig, key: string): string {
  const next = new URL(config.url);
  next.searchParams.set("key", key);
  return next.toString();
}

async function workerFetch(config: EsignWorkerConfig, key: string, init: RequestInit): Promise<Response> {
  if (!isAllowedEsignWorkerKey(key)) throw new Error("invalid_key");
  const response = await fetch(workerUrl(config, key), {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Esign-R2-Secret": config.secret,
    },
  });
  if (response.status === 401) throw new Error("not_authorized");
  if (response.status === 404) {
    const error = new Error("not_found");
    error.name = "NotFound";
    throw error;
  }
  if (!response.ok) throw new Error(`esign_r2_worker_${response.status}`);
  return response;
}

export async function getEsignWorkerBytes(config: EsignWorkerConfig, key: string): Promise<Buffer | null> {
  try {
    const response = await workerFetch(config, key, { method: "GET" });
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") return null;
    throw error;
  }
}

export async function headEsignWorker(
  config: EsignWorkerConfig,
  key: string,
): Promise<{ exists: boolean; size: number }> {
  try {
    const response = await workerFetch(config, key, { method: "HEAD" });
    const length = response.headers.get("content-length");
    return { exists: true, size: length ? Number(length) : 0 };
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") return { exists: false, size: 0 };
    throw error;
  }
}

export async function putEsignWorker(
  config: EsignWorkerConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await workerFetch(config, key, {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
  });
}
