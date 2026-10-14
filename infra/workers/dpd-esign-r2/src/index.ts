export interface Env {
  ESIGN: R2Bucket;
  ESIGN_R2_SECRET: string;
}

const ALLOWED_PREFIX = "esign-documents/";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function isAllowedKey(key: string): boolean {
  return (
    key.startsWith(ALLOWED_PREFIX) &&
    !key.includes("..") &&
    !key.includes("\\") &&
    !key.includes("\0") &&
    key.length < 512
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const secret = request.headers.get("X-Esign-R2-Secret") ?? "";
    if (!env.ESIGN_R2_SECRET || !timingSafeEqual(secret, env.ESIGN_R2_SECRET)) {
      return new Response("unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key")?.trim() ?? "";
    if (!isAllowedKey(key)) {
      return new Response("invalid_key", { status: 400 });
    }

    if (request.method === "PUT") {
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      await env.ESIGN.put(key, request.body, { httpMetadata: { contentType } });
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET") {
      const obj = await env.ESIGN.get(key);
      if (!obj) return new Response("not_found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
        },
      });
    }

    if (request.method === "HEAD") {
      const obj = await env.ESIGN.head(key);
      if (!obj) return new Response("not_found", { status: 404 });
      return new Response(null, {
        status: 204,
        headers: { "content-length": String(obj.size) },
      });
    }

    return new Response("method", { status: 405 });
  },
};
