export interface Env {
  R2: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: { width?: number; height?: number }): {
        output(options: { format: string; quality?: number }): {
          response(): Promise<Response>;
        };
      };
    };
  };
  IMAGE_SIGNING_SECRET: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyRequest(
  secret: string,
  key: string,
  w: string,
  e: string,
  s: string,
): Promise<boolean> {
  const expected = await signPayload(secret, `${key}:${w}:${e}`);
  return timingSafeEqual(expected, s);
}

function isImageKey(key: string, contentType: string): boolean {
  if (contentType === "application/pdf" || key.toLowerCase().endsWith(".pdf")) {
    return false;
  }
  if (contentType.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|heic)$/i.test(key);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key")?.trim();
    const w = url.searchParams.get("w") ?? "640";
    const e = url.searchParams.get("e");
    const s = url.searchParams.get("s");

    if (!key || !e || !s || !env.IMAGE_SIGNING_SECRET) {
      return new Response("Bad request", { status: 400 });
    }

    const expiry = Number.parseInt(e, 10);
    if (!Number.isFinite(expiry) || Math.floor(Date.now() / 1000) > expiry) {
      return new Response("Expired", { status: 403 });
    }

    const valid = await verifyRequest(env.IMAGE_SIGNING_SECRET, key, w, e, s);
    if (!valid) return new Response("Forbidden", { status: 403 });

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const obj = await env.R2.get(key);
    if (!obj?.body) return new Response("Not found", { status: 404 });

    const contentType = obj.httpMetadata?.contentType ?? "application/octet-stream";
    const width = Math.min(Math.max(Number.parseInt(w, 10) || 640, 64), 2560);

    let response: Response;
    if (isImageKey(key, contentType)) {
      response = (
        await env.IMAGES.input(obj.body)
          .transform({ width })
          .output({ format: "image/webp", quality: 75 })
      ).response();
    } else {
      response = new Response(obj.body, {
        headers: { "Content-Type": contentType },
      });
    }

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=3600, immutable");

    const final = new Response(response.body, {
      status: response.status,
      headers,
    });

    ctx.waitUntil(cache.put(cacheKey, final.clone()));
    return final;
  },
};
