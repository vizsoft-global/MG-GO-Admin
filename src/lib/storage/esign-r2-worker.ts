import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_ESIGN_R2_WORKER_URL =
  "https://dpd-esign-r2.vizsoft.workers.dev";

export type EsignR2WorkerConfig = {
  url: string;
  secret: string;
};

export type EsignStorageBackend = "s3" | "worker";

export function esignR2WorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): EsignR2WorkerConfig | null {
  const url = (env.ESIGN_R2_WORKER_URL?.trim() || DEFAULT_ESIGN_R2_WORKER_URL).replace(
    /\/+$/,
    "",
  );
  const secret = env.ESIGN_R2_WORKER_SECRET?.trim();
  if (!secret) return null;
  return { url, secret };
}

export function esignStorageBackend(
  env: NodeJS.ProcessEnv = process.env,
): EsignStorageBackend | null {
  if (
    env.R2_ACCOUNT_ID?.trim() &&
    env.R2_ACCESS_KEY_ID?.trim() &&
    env.R2_SECRET_ACCESS_KEY?.trim() &&
    env.R2_BUCKET_NAME?.trim()
  ) {
    return "s3";
  }
  return esignR2WorkerConfig(env) ? "worker" : null;
}

export function signEsignReadGrant(input: {
  key: string;
  exp: number;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.key}\n${input.exp}`)
    .digest("hex");
}

export function verifyEsignReadGrant(input: {
  key: string;
  exp: number;
  sig: string;
  secret: string;
}): boolean {
  if (!input.sig || !Number.isFinite(input.exp) || Date.now() > input.exp) {
    return false;
  }
  const expected = signEsignReadGrant({
    key: input.key,
    exp: input.exp,
    secret: input.secret,
  });
  const left = Buffer.from(input.sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isAllowedEsignR2WorkerKey(key: string): boolean {
  return (
    key.startsWith("esign-documents/") &&
    !key.includes("..") &&
    !key.includes("\\") &&
    !key.includes("\0") &&
    key.length < 512
  );
}

function workerUrl(config: EsignR2WorkerConfig, key: string): string {
  const next = new URL(config.url);
  next.searchParams.set("key", key);
  return next.toString();
}

async function workerFetch(
  config: EsignR2WorkerConfig,
  key: string,
  init: RequestInit,
): Promise<Response> {
  if (!isAllowedEsignR2WorkerKey(key)) {
    throw new Error("invalid_key");
  }
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
    (error as { name: string }).name = "NotFound";
    throw error;
  }
  if (!response.ok) {
    throw new Error(`esign_r2_worker_${response.status}`);
  }
  return response;
}

export async function putViaEsignWorker(
  config: EsignR2WorkerConfig,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const bytes = body instanceof Buffer ? body : Buffer.from(body);
  await workerFetch(config, key, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
  });
}

export async function getViaEsignWorker(
  config: EsignR2WorkerConfig,
  key: string,
): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  try {
    const response = await workerFetch(config, key, { method: "GET" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, contentType: response.headers.get("content-type") ?? undefined };
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") return null;
    throw error;
  }
}

export async function headViaEsignWorker(
  config: EsignR2WorkerConfig,
  key: string,
): Promise<{ exists: boolean; size?: number }> {
  try {
    const response = await workerFetch(config, key, { method: "HEAD" });
    const length = response.headers.get("content-length");
    return { exists: true, size: length ? Number(length) : undefined };
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") return { exists: false };
    throw error;
  }
}
