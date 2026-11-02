/**
 * The `ACC-####` reference an accident case is filed under.
 *
 * Pure on purpose: the counter itself is a Firestore transaction (see
 * `allocateAccidentReference` in `accident-actions.ts`), so nothing here can
 * write. That is what makes the backfill's dry run provably read-only — it calls
 * `projectAccidentReferences`, which only formats what it is handed.
 *
 * The same format string lives in `functions/src/rpcs/accidents.ts`, because the
 * Functions tsconfig has `rootDir: src` and cannot import from the app.
 */

export const ACCIDENT_REFERENCE_PREFIX = "ACC-";
export const ACCIDENT_REFERENCE_DIGITS = 4;
/** `counters/{id}` — one document, one sequential series. */
export const ACCIDENT_REFERENCE_COUNTER = "accident_reference_seq";
/** `vehicle_accidents.reference` shape. */
export const ACCIDENT_REFERENCE_RE = /^ACC-\d{4,}$/;

/** `7` → `ACC-0007`. A value below 1 has no reference, so it prints nothing. */
export function formatAccidentReference(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.trunc(value);
  if (n < 1) return "";
  return `${ACCIDENT_REFERENCE_PREFIX}${String(n).padStart(ACCIDENT_REFERENCE_DIGITS, "0")}`;
}

/** `ACC-0007` → `7`. Anything else → `null`. */
export function accidentReferenceNumber(reference: string | null | undefined): number | null {
  const value = (reference ?? "").trim();
  if (!ACCIDENT_REFERENCE_RE.test(value)) return null;
  const n = Number(value.slice(ACCIDENT_REFERENCE_PREFIX.length));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isAccidentReference(value: unknown): value is string {
  return typeof value === "string" && ACCIDENT_REFERENCE_RE.test(value.trim());
}

/** The reference the *next* allocation would take, given the stored counter. */
export function nextAccidentReference(current: number): string {
  const base = Number.isFinite(current) && current > 0 ? Math.trunc(current) : 0;
  return formatAccidentReference(base + 1);
}

export type AccidentReferenceProjection = {
  /** Highest reference already allocated. */
  current: number;
  /** References the next `count` allocations would take. */
  projected: string[];
  /** `ACC-0001 … ACC-0003`, for a table cell. */
  range: string;
};

/**
 * Dry-run projection: what references a backfill of `count` legacy rows *would*
 * take. It reads nothing and writes nothing — the caller passes the counter it
 * read and prints the answer.
 */
export function projectAccidentReferences(current: number, count: number): AccidentReferenceProjection {
  const base = Number.isFinite(current) && current > 0 ? Math.trunc(current) : 0;
  const total = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  const projected: string[] = [];
  for (let index = 1; index <= total; index += 1) {
    projected.push(formatAccidentReference(base + index));
  }
  const first = projected[0] ?? "";
  const last = projected[projected.length - 1] ?? "";
  return {
    current: base,
    projected,
    range: projected.length === 0 ? "" : first === last ? first : `${first} … ${last}`,
  };
}

/** Newest reference first, with an un-numbered legacy row last. */
export function compareAccidentReference(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const left = accidentReferenceNumber(a);
  const right = accidentReferenceNumber(b);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}
