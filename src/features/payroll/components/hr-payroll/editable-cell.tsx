"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { INLINE_EDIT_CELL_CLASS } from "@/components/app/constants";
import { cn } from "@/lib/utils";
import { hrCellError, parseHrAmount, type HrNumericCell } from "../../hr-cell-validation";
import type { PayrollCellStatus } from "../../use-payroll-cell-mutation";
import { optionLabel } from "./hr-payroll-ui";
import type { HrColumn } from "../../hr-payroll-columns";

const COMMIT_DEBOUNCE_MS = 400;

/** The free-text grid fields: the two bank strings and a job-end description. */
export type HrTextCellField = "bankNumber" | "currency" | "jobEndDescription";

/**
 * Move focus to the same column on the row below (`Enter`).
 *
 * The sheet is virtualised and grouped, so there is no stable row index: the
 * next `[data-hr-cell="<key>"]` after this one in document order is the next
 * editable cell, which is exactly what "commit and go down" means.
 */
function focusNextRow(current: HTMLElement, key: string): void {
  const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-hr-cell="${key}"]`));
  const index = cells.indexOf(current);
  const next = index >= 0 ? cells[index + 1] : undefined;
  next?.focus();
}

function StateMark({ status }: { status: PayrollCellStatus }) {
  if (status.state === "pending") {
    return <Loader2 className="pointer-events-none absolute end-1 top-1/2 size-3 -translate-y-1/2 animate-spin text-muted-foreground" />;
  }
  if (status.state === "saved") {
    return <Check className="pointer-events-none absolute end-1 top-1/2 size-3 -translate-y-1/2 text-emerald-600" />;
  }
  return null;
}

/**
 * A free numeric grid cell that saves itself.
 *
 * One click edits; typing debounces a save at 400 ms so `1250` is one write, not
 * four; `Enter` commits and walks down the column; `Tab` commits and walks right;
 * `Escape` cancels and writes nothing. A refused value keeps the operator's text
 * with a destructive outline and the server's reason, instead of silently
 * reverting to the previous number.
 */
export function HrAmountCell({
  driverId,
  field,
  columnKey,
  display,
  current,
  status,
  errorText,
  canEdit,
  onCommit,
}: {
  driverId: string;
  field: HrNumericCell;
  columnKey: string;
  display: string;
  current: number;
  status: PayrollCellStatus;
  errorText: (reason: string | undefined) => string;
  canEdit: boolean;
  onCommit: (driverId: string, field: HrNumericCell, value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  /**
   * A saved cell drops the draft so the formatted figure shows through again.
   * Derived rather than synced in an effect: a `setState` in an effect cascades
   * an extra render on every save, and this is a pure function of the status.
   */
  const liveDraft = status.state === "saved" ? null : draft;
  const error = status.state === "error" ? errorText(status.error) : null;

  /**
   * A cleared box commits zero (see `parseHrAmount`), so deleting a deduction
   * writes `0` instead of leaving the old figure on screen; anything that is not
   * a number is refused and keeps the operator's text. Dropping the draft on blur
   * puts the cell back on the formatted `0.000` figure the sheet prints.
   */
  function commit(text: string): void {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const parsed = parseHrAmount(text);
    if (parsed === null) return;
    if (hrCellError(field, parsed)) return;
    if (parsed === current) return;
    onCommit(driverId, field, parsed);
  }

  function schedule(text: string): void {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      commit(text);
    }, COMMIT_DEBOUNCE_MS);
  }

  return (
    <span className="relative inline-flex w-full items-center">
      <input
        data-hr-cell={columnKey}
        className={cn(
          INLINE_EDIT_CELL_CLASS,
          "w-full pe-5 tabular-nums",
          error && "border-destructive ring-1 ring-destructive/40",
        )}
        value={liveDraft ?? display}
        title={error ?? undefined}
        aria-invalid={error ? true : undefined}
        readOnly={!canEdit}
        onFocus={(event) => {
          const next = String(current);
          setDraft(next);
          event.currentTarget.value = next;
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          schedule(event.target.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
            focusNextRow(event.currentTarget, columnKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (timer.current != null) {
              window.clearTimeout(timer.current);
              timer.current = null;
            }
            setDraft(null);
            event.currentTarget.blur();
          } else if (event.key === "Tab") {
            commit(event.currentTarget.value);
          }
        }}
        onBlur={(event) => {
          commit(event.currentTarget.value);
          // Keep the typed text only while the server is refusing it.
          if (status.state !== "error") setDraft(null);
        }}
      />
      <StateMark status={status} />
    </span>
  );
}

/**
 * A debounced free-text grid cell (bank account number, currency).
 *
 * Same contract as the amount cell: one click edits, 600 ms of quiet commits,
 * Enter commits and walks down, Escape writes nothing, and a refusal keeps the
 * operator's text with the server's reason.
 */
export function HrTextCell({
  driverId,
  field,
  columnKey,
  value,
  status,
  errorText,
  canEdit,
  onCommit,
  debounceMs = 600,
  ariaLabel,
}: {
  driverId: string;
  field: HrTextCellField;
  columnKey: string;
  value: string;
  status: PayrollCellStatus;
  errorText: (reason: string | undefined) => string;
  canEdit: boolean;
  onCommit: (driverId: string, field: HrTextCellField, value: string) => void;
  /** A description is prose, so it waits longer than an account number. */
  debounceMs?: number;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  const liveDraft = status.state === "saved" ? null : draft;
  const error = status.state === "error" ? errorText(status.error) : null;

  function commit(text: string): void {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (text.trim() === value.trim()) return;
    onCommit(driverId, field, text.trim());
  }

  function schedule(text: string): void {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      commit(text);
    }, debounceMs);
  }

  return (
    <span className="relative inline-flex w-full items-center">
      <input
        data-hr-cell={columnKey}
        className={cn(
          INLINE_EDIT_CELL_CLASS,
          "w-full pe-5",
          error && "border-destructive ring-1 ring-destructive/40",
        )}
        value={liveDraft ?? value}
        aria-label={ariaLabel}
        title={error ?? undefined}
        aria-invalid={error ? true : undefined}
        readOnly={!canEdit}
        onFocus={(event) => {
          setDraft(value);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          schedule(event.target.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
            focusNextRow(event.currentTarget, columnKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (timer.current != null) {
              window.clearTimeout(timer.current);
              timer.current = null;
            }
            setDraft(null);
            event.currentTarget.blur();
          } else if (event.key === "Tab") {
            commit(event.currentTarget.value);
          }
        }}
        onBlur={(event) => {
          commit(event.currentTarget.value);
          if (status.state !== "error") setDraft(null);
        }}
      />
      <StateMark status={status} />
    </span>
  );
}

/**
 * A catalog-backed identity cell (Bank, Zone, Client). A pick commits at once.
 * The current value stays selectable even when the catalog no longer lists it, so
 * an old assignment is never blanked.
 */
export function HrOptionCell({
  value,
  options,
  emptyLabel,
  ariaLabel,
  status,
  errorText,
  canEdit,
  onCommit,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  emptyLabel: string;
  ariaLabel: string;
  status: PayrollCellStatus;
  errorText: (reason: string | undefined) => string;
  canEdit: boolean;
  onCommit: (value: string) => void;
}) {
  const error = status.state === "error" ? errorText(status.error) : null;
  const known = options.some((option) => option.value === value);
  return (
    <select
      className={cn(INLINE_EDIT_CELL_CLASS, "w-full", error && "border-destructive ring-1 ring-destructive/40")}
      value={value}
      aria-label={ariaLabel}
      title={error ?? undefined}
      disabled={!canEdit}
      aria-invalid={error ? true : undefined}
      onChange={(event) => onCommit(event.target.value)}
    >
      {!known ? <option value={value}>{value || emptyLabel}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A grid cell bound to a date.
 *
 * The picker writes on `change`, which a native date input fires the moment a
 * day is chosen — no separate commit control, and `onBlur` catches a keyboard
 * entry the browser did not treat as a change. Clearing the picker sends `""`,
 * which the callable turns into `FieldValue.delete()`.
 */
export function HrDateCell({
  value,
  ariaLabel,
  status,
  errorText,
  canEdit,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  status: PayrollCellStatus;
  errorText: (reason: string | undefined) => string;
  canEdit: boolean;
  onCommit: (value: string) => void;
}) {
  const error = status.state === "error" ? errorText(status.error) : null;
  return (
    <input
      type="date"
      className={cn(INLINE_EDIT_CELL_CLASS, "w-full", error && "border-destructive ring-1 ring-destructive/40")}
      value={value}
      aria-label={ariaLabel}
      title={error ?? undefined}
      disabled={!canEdit}
      aria-invalid={error ? true : undefined}
      onChange={(event) => onCommit(event.target.value)}
      onBlur={(event) => {
        // A browser that reports the typed value only on blur still commits.
        if (event.target.value !== value) onCommit(event.target.value);
      }}
    />
  );
}

export function HrSelectCell({
  driverId,
  field,
  value,
  column,
  status,
  errorText,
  canEdit,
  onCommit,
}: {
  driverId: string;
  field: HrNumericCell;
  value: number;
  column: HrColumn;
  status: PayrollCellStatus;
  errorText: (reason: string | undefined) => string;
  canEdit: boolean;
  onCommit: (driverId: string, field: HrNumericCell, value: number) => void;
}) {
  const error = status.state === "error" ? errorText(status.error) : null;
  const options = column.select ?? [];
  return (
    <select
      className={cn(INLINE_EDIT_CELL_CLASS, "w-full", error && "border-destructive ring-1 ring-destructive/40")}
      value={String(value)}
      title={error ?? undefined}
      disabled={!canEdit}
      aria-invalid={error ? true : undefined}
      onChange={(event) => onCommit(driverId, field, Number(event.target.value))}
    >
      {options.map((item) => (
        <option key={item} value={String(item)}>
          {optionLabel(item, column)}
        </option>
      ))}
    </select>
  );
}
