import { customFieldColumnId } from "@/lib/custom-fields/types";
import type { CustomColumnDef, RosterRow } from "@/features/operations-dashboard/shape";

/**
 * The Rider Operations column plan.
 *
 * Two kinds of column live in one ordered list, and the difference decides what
 * the operator may do with it:
 *
 * - **base** — a field the roster payload already carries (`employeeId`, `name`,
 *   … `phone`). Its heading is the app's own translated label, so it can be
 *   renamed only through `customLabel`; a stored `label` is ignored on purpose,
 *   because an older definition holds the English default and honouring it would
 *   put an English heading on the Arabic panel.
 * - **custom** — an operator-defined heading over a driver custom field
 *   (`drivers.custom_fields[key]`). It owns its `label`, and it prints `—` until
 *   somebody fills that field on the employee.
 *
 * The plan is always complete: a base field the stored definition never mentions
 * is appended in catalogue order, so a rider cannot lose a column because an old
 * document predates it. Hiding is therefore a stored `visible: false`, which is
 * why there is no delete for a base column — deleting it would only make it
 * reappear from the catalogue on the next read.
 */
export const ROSTER_BASE_FIELDS = [
  "employeeId",
  "name",
  "project",
  "zone",
  "status",
  "joined",
  "nationalityCategory",
  "nationalityCountry",
  "phone",
] as const;

export type RosterBaseField = (typeof ROSTER_BASE_FIELDS)[number];

export type RosterColumnKind = "base" | "custom";

export type RosterColumnPlanEntry = {
  id: string;
  kind: RosterColumnKind;
  field: string;
  /** Base: "" means use the app's translated heading. Custom: the operator's heading. */
  label: string;
  visible: boolean;
};

const BASE_FIELD_SET = new Set<string>(ROSTER_BASE_FIELDS);

export function isBaseRosterField(field: string): field is RosterBaseField {
  return BASE_FIELD_SET.has(field);
}

/** The roster field a custom column prints, from a raw `custom_fields` value. */
export function rosterCustomFieldText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === "string" ? item.trim() : String(item))).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "—";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") return value.trim() || "—";
  return "—";
}

function entryField(entry: CustomColumnDef): string {
  return (entry.field ?? "").trim() || (entry.id ?? "").replace(/^cf:/, "").trim();
}

function entryLabel(entry: CustomColumnDef): string {
  return (entry.customLabel ?? "").trim();
}

/**
 * Every column the table should offer, in the order it should offer it.
 *
 * Pass `includePhone: false` for a partner session: the roster payload withholds
 * the number there, and a column that exists but can never print is worse than
 * one that is absent.
 */
export function planRosterColumns(
  entries: readonly CustomColumnDef[],
  opts: { includePhone: boolean },
): RosterColumnPlanEntry[] {
  const plan: RosterColumnPlanEntry[] = [];
  const taken = new Set<string>();
  const push = (entry: RosterColumnPlanEntry) => {
    if (taken.has(entry.id)) return;
    taken.add(entry.id);
    plan.push(entry);
  };

  for (const entry of entries) {
    const field = entryField(entry);
    if (!field) continue;
    if (isBaseRosterField(field)) {
      if (field === "phone" && !opts.includePhone) continue;
      push({ id: field, kind: "base", field, label: entryLabel(entry), visible: entry.visible !== false });
      continue;
    }
    push({
      id: customFieldColumnId(field),
      kind: "custom",
      field,
      label: (entry.label ?? "").trim() || field,
      visible: entry.visible !== false,
    });
  }

  for (const base of ROSTER_BASE_FIELDS) {
    if (base === "phone" && !opts.includePhone) continue;
    push({ id: base, kind: "base", field: base, label: "", visible: true });
  }

  return plan;
}

export function visibleRosterColumns(plan: readonly RosterColumnPlanEntry[]): RosterColumnPlanEntry[] {
  return plan.filter((entry) => entry.visible);
}

/**
 * The plan as stored definitions, i.e. after the missing base fields have been
 * written out. Reordering needs this: an entry that only exists because the
 * catalogue supplied it cannot be moved until it is materialised.
 */
export function materialiseRosterColumns(
  entries: readonly CustomColumnDef[],
  opts: { includePhone: boolean },
): CustomColumnDef[] {
  return planRosterColumns(entries, opts).map((entry) => ({
    id: entry.id,
    field: entry.field,
    label: entry.kind === "custom" ? entry.label : "",
    customLabel: entry.kind === "base" ? entry.label : "",
    visible: entry.visible,
  }));
}

/** Move one column one slot in `dir`, clamped at the ends. */
export function moveRosterColumn<T extends { id: string }>(entries: readonly T[], id: string, dir: -1 | 1): T[] {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return [...entries];
  const target = index + dir;
  if (target < 0 || target >= entries.length) return [...entries];
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Append a custom column, or replace the one already carrying that key. */
export function upsertRosterColumn(
  entries: readonly CustomColumnDef[],
  column: CustomColumnDef,
): CustomColumnDef[] {
  const index = entries.findIndex((entry) => entry.id === column.id);
  if (index < 0) return [...entries, column];
  const next = [...entries];
  next[index] = column;
  return next;
}

export function newRosterCustomColumn(key: string, label: string): CustomColumnDef {
  const field = key.trim();
  return {
    id: customFieldColumnId(field),
    field,
    label: label.trim() || field,
    visible: true,
  };
}

/** A custom column's own value for one rider. Base fields are read off the row. */
export function rosterCustomValue(row: RosterRow, field: string): unknown {
  return row.customFields?.[field];
}
