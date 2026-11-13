import type { ColumnFilterDraft } from "@/components/app/column-filter";
import type { ColumnFilterValue } from "./payroll-column-filter-match";

/**
 * The payroll filter shapes a draft turns into.
 *
 * Kept out of `payroll-column-filter.tsx` because that file is a client
 * component: these are the rules that decide what typing does versus what Apply
 * does, and they are worth asserting without a renderer in the way.
 */
export type PayrollColumnFilterValue = ColumnFilterValue;

/**
 * What Apply commits: the operator's own text, ticks or bounds.
 *
 * A search typed into the List tab is deliberately **not** part of it — it
 * narrows the table while the popover is open, and Apply still means the ticks.
 */
export function draftToColumnFilter(draft: ColumnFilterDraft): PayrollColumnFilterValue | null {
  switch (draft.mode) {
    case "text": {
      const text = draft.text.trim();
      return text ? { kind: "text", text } : null;
    }
    case "list":
      return draft.picked.length ? { kind: "list", values: draft.picked } : null;
    case "range": {
      const min = draft.min.trim() === "" ? null : Number(draft.min);
      const max = draft.max.trim() === "" ? null : Number(draft.max);
      const safeMin = min !== null && Number.isFinite(min) ? min : null;
      const safeMax = max !== null && Number.isFinite(max) ? max : null;
      return safeMin === null && safeMax === null
        ? null
        : { kind: "range", min: safeMin, max: safeMax };
    }
    default: {
      const exhaustive: never = draft.mode;
      return exhaustive;
    }
  }
}

/**
 * What a keystroke narrows the table to, before Apply.
 *
 * A search in the List tab is a filter on this column's printed value, so the
 * rows answer the box immediately instead of waiting for a tick list. Any other
 * draft behaves exactly like Apply, which is what keeps Text and Range live.
 */
export function draftToLiveFilter(draft: ColumnFilterDraft): PayrollColumnFilterValue | null {
  if (draft.mode === "list" && draft.query.trim()) {
    return { kind: "text", text: draft.query.trim() };
  }
  return draftToColumnFilter(draft);
}
