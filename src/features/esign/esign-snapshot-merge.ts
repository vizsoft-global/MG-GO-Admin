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
 * Switching the selected rider replaces every cell on the next rider.
 *
 * The previous version inferred "the operator typed this" by comparing the cell
 * against the previous snapshot, and treated a cell that matched as untouched.
 * That works only while the previous snapshot is known, and the caller nulled it
 * on any failed fetch — after which every one of the previous rider's values
 * looked operator-typed and survived the switch. It also could not tell a value
 * the operator retyped identically from one the app filled in, and a draft
 * restored from `field_values` looked entirely typed.
 *
 * `touched` is the answer instead: the component records the keys a human
 * actually edited, and nothing else is treated as typed. Everything else takes
 * the new rider's snapshot, including a key the previous rider had a value for —
 * which is what stops rider A's civil ID printing under rider B's name.
 *
 * A key the next snapshot does not carry is cleared rather than left holding the
 * previous rider's value. The one exception is a hidden control (a penalty
 * checkbox, the request kind): those are not rider data, so they are reported in
 * `touched` by the caller and keep their state.
 */
export function applyEmployeeSnapshotChange(
  nextSnap: Record<string, string> | null | undefined,
  values: Record<string, string>,
  fields: readonly SnapshotMergeField[],
  touched: ReadonlySet<string>,
): Record<string, string> {
  const next: Record<string, string> = { ...values };
  const keys = new Set(fields.map((field) => field.field_key));
  for (const key of Object.keys(values)) keys.add(key);
  for (const key of Object.keys(nextSnap ?? {})) keys.add(key);

  for (const key of keys) {
    if (touched.has(key)) continue;
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
