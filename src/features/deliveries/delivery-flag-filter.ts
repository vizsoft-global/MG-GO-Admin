/**
 * The delivery flag filter, as a query rather than a row predicate.
 *
 * The reported defect was that "Photo mismatch" returned the same rows as
 * "All flags". The row predicate was right; the **route** was the problem — any
 * flag short-circuited to a 20,000-document in-memory scan (measured 89.5 s on
 * production), the request died on the platform timeout, and the previous
 * unfiltered page stayed on screen. So the filter looked inert.
 *
 * All three flags are boolean columns on `deliveries`, which means each one
 * answers with a single-field equality: no composite index to invent, no
 * document reads beyond the page. This module is separate from the server action
 * so the rule can be tested without pulling in `"use server"`.
 */

export type DeliveryFlagFilter = "all" | "early_drop" | "outside_zone" | "photo_mismatch";

export type FlagEquality = { field: string; value: boolean };

/**
 * The field and value a flag filters on, or `null` for "all".
 *
 * `photo_mismatch` is deliberately `== false`, never `!= true`: the OCR column is
 * `null` on **19,895 of 20,000** production rows because OCR only runs on a
 * completed delivery, and `null` means "not checked", not "mismatch". A `!= true`
 * match would paint almost the entire fleet red.
 */
export function flagFilterOf(flags: DeliveryFlagFilter | undefined): FlagEquality | null {
  switch (flags) {
    case "early_drop":
      return { field: "is_early_drop", value: true };
    case "outside_zone":
      return { field: "is_out_of_zone", value: true };
    case "photo_mismatch":
      return { field: "order_proof_ocr_matched", value: false };
    case "all":
    default:
      return null;
  }
}

/**
 * Whether the rows have to be in hand to filter them.
 *
 * A flag no longer qualifies — it is an indexed equality. What remains is free-text
 * search and the cancel-reason list, because neither is a stored field.
 */
export function needsMemoryFilter(params: {
  search?: string;
  cancelReason?: string;
}): boolean {
  return Boolean(
    params.search?.trim() || (params.cancelReason && params.cancelReason !== "all"),
  );
}
