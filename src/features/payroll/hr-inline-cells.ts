/**
 * The rules behind the HR sheet's inline cells, kept out of the component.
 *
 * Two decisions live here because they are the ones that can be wrong silently:
 * which column stores which key, and what a toolbar filter offers. The grid and
 * the tab both read this module, and the tests pin it.
 */
import type { HrPayrollRow } from "./hr-payroll-types";

export type HrCatalogOptionsKey =
  | "nationalities"
  | "nationalityCategories"
  | "restaurants"
  | "sponsorships"
  | "sections"
  | "positions"
  | "companies"
  | "hiringTypes"
  | "jobEndDescriptions";

export type HrCatalogCellSpec = {
  /** The identity patch key the picker writes. */
  field:
    | "nationalityCode"
    | "nationalityCategoryKey"
    | "restaurantId"
    | "sponsorKey"
    | "sectionKey"
    | "positionKey"
    | "companyKey"
    | "hiringType";
  /** Which master supplies the labels. */
  optionsKey: HrCatalogOptionsKey;
  /** The stored key on the row, so the picker binds to an identity, not a label. */
  valueOf: (row: HrPayrollRow) => string;
};

/**
 * One table for eight columns, because they differ only in which key is stored
 * and which master supplies the labels.
 *
 * `start` / `endDate` / `endDesc` are deliberately absent: a date and a prose
 * field have their own cell types, and listing them here would imply they are
 * catalog picks.
 */
export const HR_CATALOG_CELLS: Record<string, HrCatalogCellSpec> = {
  nationality: {
    field: "nationalityCode",
    optionsKey: "nationalities",
    valueOf: (row) => row.nationalityCode,
  },
  natCat: {
    field: "nationalityCategoryKey",
    optionsKey: "nationalityCategories",
    valueOf: (row) => row.nationalityCategoryKey,
  },
  rest: { field: "restaurantId", optionsKey: "restaurants", valueOf: (row) => row.restaurantId },
  sponsor: { field: "sponsorKey", optionsKey: "sponsorships", valueOf: (row) => row.sponsorKey },
  hiring: { field: "hiringType", optionsKey: "hiringTypes", valueOf: (row) => row.hiringType },
  section: { field: "sectionKey", optionsKey: "sections", valueOf: (row) => row.sectionKey },
  position: { field: "positionKey", optionsKey: "positions", valueOf: (row) => row.positionKey },
  company: { field: "companyKey", optionsKey: "companies", valueOf: (row) => row.companyKey },
};

/**
 * The two date columns, and the identity key each one writes.
 *
 * `jobEnd` is the stored field and `endDate` the column id, which is exactly the
 * kind of mismatch that would leave a picker writing to nothing if it were only
 * spelled out in a component.
 */
export const HR_DATE_CELLS: Record<string, "workStartDate" | "jobEndDate"> = {
  start: "workStartDate",
  endDate: "jobEndDate",
};

/**
 * One filter list: the values the sheet already prints, then the rest of the
 * master behind them.
 *
 * The toolbar filter matches the printed cell, so its options are labels. What
 * the sheet holds comes first because that is what an operator narrows by; the
 * remainder of the catalog follows, so a restaurant, section or nationality
 * added in Employee Settings is pickable before any rider carries it — which is
 * the sync the requirement asks for on the filters as well as on the cells.
 */
export function masterFilterValues(
  present: readonly string[],
  master: readonly string[],
  skip: ReadonlySet<string> = new Set(["", "—", "–", "-"]),
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...present, ...master]) {
    const trimmed = value.trim();
    if (!trimmed || skip.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
