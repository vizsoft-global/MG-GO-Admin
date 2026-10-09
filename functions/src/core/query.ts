import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

/**
 * Accepts the three shapes a caller can send for an instant: an ISO string, epoch
 * milliseconds, or a Firestore Timestamp. Rejecting rather than coercing matters
 * because `new Date("nonsense")` is `Invalid Date`, and a query built on it
 * either throws deep inside the SDK or — worse for a count — silently matches
 * nothing and reports zero.
 */
export function parseInstant(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new HttpsError("invalid-argument", `invalid_${field}`);
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);

  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpsError("invalid-argument", `invalid_${field}`);
    }
    return parsed;
  }

  throw new HttpsError("invalid-argument", `invalid_${field}`);
}

/** A non-empty trimmed string, or null. Never returns `""`. */
export function parseId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** A comma-free string list from either an array or a comma-separated string. */
export function parseIdList(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!raw) return null;
  const out = raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return out;
}
