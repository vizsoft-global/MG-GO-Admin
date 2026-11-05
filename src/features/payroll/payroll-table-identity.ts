/**
 * One identity block for every payroll sheet.
 *
 * The client asked for the same four leading columns on Payroll, HR Payroll,
 * Combined, Attendance & Orders, Application Attendance and Requests: `#`,
 * `MG ID`, `Client ID`, `Employee Name`. Before this module each table kept its
 * own trio and its own sticky widths, so the order and the frozen offsets
 * disagreed between tabs.
 *
 * `orderIdentityColumns` is a *stable* hoist: the four identity columns move to
 * the front in the sequence above and every other column keeps its current
 * relative order, so nothing else in a sheet is re-ordered by accident.
 */

/** The order every payroll table leads with. */
export const PAYROLL_IDENTITY_SEQUENCE = ["serial", "mgId", "clientId", "name"] as const;

export type PayrollIdentityKey = (typeof PAYROLL_IDENTITY_SEQUENCE)[number];

/** Frozen width per identity column. One source for headers and body cells. */
export const PAYROLL_IDENTITY_WIDTH: Record<PayrollIdentityKey, number> = {
  serial: 56,
  mgId: 96,
  clientId: 120,
  name: 190,
};

/**
 * Column ids that *mean* one of the four. The catalogues are older than this
 * module and their keys are not the words they print:
 *
 * - `amId` prints **MG ID** (`riderCols.amId`), and the HR sheet spells it `mg`.
 * - `mgId` prints **Driver ID** (`drivers.driver_code`). HR's "Client ID" is a
 *   different field (`drivers.client_id`), so the two sheets keep their own words.
 * - HR spells the serial `i`.
 *
 * Mapping them here is what lets one sequence rule apply without renaming a key
 * the CSV, the filters and the saved column preferences already read.
 */
const IDENTITY_ALIASES: Readonly<Record<string, PayrollIdentityKey>> = {
  serial: "serial",
  i: "serial",
  amId: "mgId",
  mg: "mgId",
  mgId: "clientId",
  client: "clientId",
  clientId: "clientId",
  name: "name",
};

/** Trailing action column that opens the employee file. Not part of the block. */
export const PAYROLL_ROW_ACTION_COLUMN_ID = "__rowAction";

export function identityKeyOf(columnId: string): PayrollIdentityKey | null {
  return IDENTITY_ALIASES[columnId] ?? null;
}

export function isIdentityColumn(columnId: string): boolean {
  return identityKeyOf(columnId) !== null;
}

/** 0 → serial, 1 → MG ID, 2 → Client ID, 3 → Employee Name, -1 → not identity. */
export function identityRank(columnId: string): number {
  const key = identityKeyOf(columnId);
  return key ? PAYROLL_IDENTITY_SEQUENCE.indexOf(key) : -1;
}

/** Frozen width, or 0 when the column is not part of the identity block. */
export function identityWidth(columnId: string): number {
  const key = identityKeyOf(columnId);
  return key ? PAYROLL_IDENTITY_WIDTH[key] : 0;
}

/**
 * Hoist the identity columns to the front, stably. A column outside the block
 * keeps its position relative to the other non-identity columns.
 */
export function orderIdentityColumns<T extends { id: string }>(columns: readonly T[]): T[] {
  return columns
    .map((column, index) => ({ column, index, rank: identityRank(column.id) }))
    .sort((a, b) => {
      const left = a.rank < 0 ? Number.MAX_SAFE_INTEGER : a.rank;
      const right = b.rank < 0 ? Number.MAX_SAFE_INTEGER : b.rank;
      if (left !== right) return left - right;
      return a.index - b.index;
    })
    .map((entry) => entry.column);
}

/**
 * Cumulative `insetInlineStart` per column: the frozen offset for an identity
 * column, `-1` for anything that scrolls. Headers and body cells read the same
 * array, so they cannot disagree.
 */
export function identityOffsets(columns: readonly { id: string }[]): number[] {
  let left = 0;
  return columns.map((column) => {
    const width = identityWidth(column.id);
    if (!width) return -1;
    const at = left;
    left += width;
    return at;
  });
}

/** The frozen offset of the column at `index`, or `0` when it is not frozen. */
export function identityOffsetAt(columns: readonly { id: string }[], index: number): number {
  const offsets = identityOffsets(columns);
  const offset = offsets[index] ?? -1;
  return offset < 0 ? 0 : offset;
}

/** How many leading columns are frozen. */
export function identityCount(columns: readonly { id: string }[]): number {
  return identityOffsets(columns).filter((offset) => offset >= 0).length;
}

/**
 * Lead a catalogue with the serial column, then the rest of the identity block.
 * The serial is synthetic — it is rendered from the row position, so it stays
 * out of the CSV and the saved column preferences.
 */
export function withSerialColumn<T extends { id: string }>(
  columns: readonly T[],
  serial: T,
): T[] {
  const withoutSerial = columns.filter((column) => identityKeyOf(column.id) !== "serial");
  return [serial, ...orderIdentityColumns(withoutSerial)];
}
