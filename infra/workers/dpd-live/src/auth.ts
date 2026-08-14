/**
 * Admin socket tokens.
 *
 * The Worker cannot evaluate Postgres RLS, so it cannot decide whether a browser is
 * allowed to watch the fleet. Permission is checked in the admin app
 * (`POST /api/live-tracking-v2/token`, behind `requirePermission`) and the result is
 * handed to the Worker as a short-lived signed assertion. The Worker's only job is
 * to verify the signature and the expiry.
 */

export type AdminTokenPayload = {
  /** Admin user id, for logging only. */
  sub: string;
  room: string;
  /** Unix seconds. */
  exp: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAdminToken(
  secret: string,
  payload: AdminTokenPayload,
): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyAdminToken(
  secret: string,
  token: string,
  nowMs = Date.now(),
): Promise<AdminTokenPayload | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  // crypto.subtle.verify is constant-time, which a manual string compare of the
  // signature would not be.
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    base64UrlDecode(signature),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as
      | AdminTokenPayload
      | null;
    if (!payload?.exp || payload.exp * 1000 < nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return base64UrlEncode(new Uint8Array(digest));
}
