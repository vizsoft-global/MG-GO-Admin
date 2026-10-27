/** One Firestore document is 1,048,576 bytes. A filled roster does not fit in one. */
export const FIRESTORE_DOC_BYTES = 1_048_576;

/** Stay under the 4MB server-action body cap, including protocol overhead. */
export const IMPORT_PAYLOAD_SLICE_BYTES = 2_000_000;

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Document ids sort in sheet order. Width 8 stays ordered through 99,999,999. */
export function pendingRowDocId(index: number): string {
  return String(index).padStart(8, "0");
}

export function storedImportRow<T>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

/**
 * Split a start payload so each server action stays under `maxBytes`.
 * A single row that is already over the cap is still sent alone.
 */
export function sliceImportRows<T>(rows: readonly T[], maxBytes: number): T[][] {
  const slices: T[][] = [];
  let current: T[] = [];
  let used = 2;
  for (const row of rows) {
    const rowBytes = jsonByteLength(row) + 1;
    if (current.length > 0 && used + rowBytes > maxBytes) {
      slices.push(current);
      current = [row];
      used = 2 + rowBytes;
      continue;
    }
    current.push(row);
    used += rowBytes;
  }
  if (current.length > 0) slices.push(current);
  return slices;
}
