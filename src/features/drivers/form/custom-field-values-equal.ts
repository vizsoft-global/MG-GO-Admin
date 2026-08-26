import type { CustomFieldValues } from "@/lib/custom-fields/types";

/**
 * Shallow equality for a custom-field map.
 *
 * This exists so the Add-form effect that merges definition defaults into the
 * current values can return the *previous* object when the merge changed
 * nothing. An effect that always produces a new object schedules a render every
 * time it runs, which turns any churn in its dependencies into an infinite
 * render loop rather than wasted work — the failure that blanked `/drivers`
 * with React's "Maximum update depth exceeded".
 *
 * Multiselect fields hold arrays, so arrays are compared element-wise. One
 * level is enough: no custom field type nests deeper than that.
 */
export function sameCustomFieldValues(
  a: CustomFieldValues,
  b: CustomFieldValues,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;

  return aKeys.every((key) => {
    // A key present in `a` but absent from `b` must not pass on `undefined`
    // equality — the two maps genuinely differ.
    if (!Object.hasOwn(b, key)) return false;

    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((item, i) => item === right[i])
      );
    }
    return left === right;
  });
}
