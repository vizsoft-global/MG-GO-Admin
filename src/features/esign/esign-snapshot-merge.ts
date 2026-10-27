export type SnapshotMergeField = {
  field_key: string;
};

/**
 * Typed values win. Empty overlapping keys take the snapshot. Missing
 * snapshot extras stay empty so bulk Review can still show `add_value`.
 */
export function mergeFieldValuesForSend(
  snapshot: Record<string, string> | null | undefined,
  values: Record<string, string>,
  fields: readonly SnapshotMergeField[],
): Record<string, string> {
  const snap = snapshot ?? {};
  const next: Record<string, string> = { ...values };
  for (const field of fields) {
    const key = field.field_key;
    const typed = values[key]?.trim() ?? "";
    if (typed) {
      next[key] = typed;
      continue;
    }
    const fromSnap = snap[key]?.trim() ?? "";
    if (fromSnap) next[key] = fromSnap;
  }
  return next;
}

function snapText(snapshot: Record<string, string> | null | undefined, key: string): string {
  return snapshot?.[key]?.trim() ?? "";
}

/**
 * Switching the selected rider replaces every cell that still holds that
 * rider's snapshot. A cell the operator typed (different from the previous
 * snapshot) stays. A blank cell on the next rider clears the previous rider's
 * leftover name, bank number, or date.
 */
export function applyEmployeeSnapshotChange(
  previous: Record<string, string> | null | undefined,
  nextSnap: Record<string, string> | null | undefined,
  values: Record<string, string>,
  fields: readonly SnapshotMergeField[],
): Record<string, string> {
  if (!previous) {
    return mergeFieldValuesForSend(nextSnap, values, fields);
  }
  const next: Record<string, string> = { ...values };
  const keys = new Set(fields.map((field) => field.field_key));
  for (const key of Object.keys(previous)) keys.add(key);
  for (const key of Object.keys(nextSnap ?? {})) keys.add(key);
  for (const key of keys) {
    const typed = values[key]?.trim() ?? "";
    const fromPrev = snapText(previous, key);
    if (typed && typed !== fromPrev) continue;
    next[key] = snapText(nextSnap, key);
  }
  return next;
}

export function firstMissingRequiredKey(
  values: Record<string, string>,
  fields: readonly { field_key: string; is_required?: boolean }[],
): string | null {
  for (const field of fields) {
    if (!field.is_required) continue;
    if (!values[field.field_key]?.trim()) return field.field_key;
  }
  return null;
}
