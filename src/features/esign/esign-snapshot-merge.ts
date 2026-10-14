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
