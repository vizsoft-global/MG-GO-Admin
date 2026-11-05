/**
 * The client mirror of `validCell` in `functions/src/rpcs/hr-payroll.ts`.
 *
 * The server is the only writer, but the sheet refuses a value **before** it
 * posts one, so an operator is told why a number cannot be saved instead of
 * watching it revert. `hrCellValidation.test.ts` locks the two lists together.
 */
export type HrNumericCell =
  | "twoYear"
  | "fourYear"
  | "food"
  | "sick"
  | "pending"
  | "traffic"
  | "loan"
  | "allowances"
  | "deductions";

/** Food allowance is a two-value list; the sheet renders it as a select. */
export const HR_FOOD_VALUES: readonly number[] = [0, 15];

export const HR_SICK_MIN = 0;
export const HR_SICK_MAX = 30;

/**
 * Why a value is refused, or `null` when it is acceptable.
 *
 * `twoYear` / `fourYear` are KWD amounts the client negotiates, not a closed set:
 * the 2-year and 4-year increment is whatever HR agreed, so typing `3` must save
 * `3`. `food` stays a list because it is a fixed allowance and renders a select.
 */
export function hrCellError(field: HrNumericCell, value: number): string | null {
  if (!Number.isFinite(value)) return "not_a_number";
  switch (field) {
    case "twoYear":
    case "fourYear":
      return value >= 0 ? null : "negative";
    case "food":
      return HR_FOOD_VALUES.includes(value) ? null : "food_list";
    case "sick":
      return Number.isInteger(value) && value >= HR_SICK_MIN && value <= HR_SICK_MAX
        ? null
        : "sick_range";
    case "pending":
    case "traffic":
    case "loan":
    case "allowances":
    case "deductions":
      return value >= 0 ? null : "negative";
    default: {
      const never: never = field;
      return never;
    }
  }
}

/** Parse what the operator typed. A blank cell is `null` (nothing to save). */
export function parseHrAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** The server code (`invalid_cell:two_year_applicable`) as the field it names. */
export function hrInvalidCellField(message: string): string | null {
  const match = /^invalid_cell:(\w+)$/.exec(message.trim());
  return match?.[1] ?? null;
}
