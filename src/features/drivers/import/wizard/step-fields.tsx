"use client";

import { Check, Lock, Plus, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { DriverImportColumnSpec } from "../template";
import {
  IMPORT_FIELD_GROUPS,
  fieldGroup,
  type ImportWizardMode,
} from "../wizard-state";

/**
 * Step 2. Every column on the left, the sheet's columns on the right.
 *
 * The old picker was a dropdown of checkboxes, so the operator could not see
 * what they had chosen without opening it. Here the choice is the screen: click
 * a column in, click it out again, and the workbook is generated from exactly
 * this list.
 */
export function ImportStepFields({
  columns,
  selected,
  pinned,
  mode,
  onToggle,
  onSelectAll,
  onRequiredOnly,
}: {
  columns: readonly DriverImportColumnSpec[];
  selected: ReadonlySet<string>;
  pinned: readonly string[];
  mode: ImportWizardMode;
  onToggle: (field: string) => void;
  onSelectAll: () => void;
  onRequiredOnly: () => void;
}) {
  const t = useTranslations("pages.drivers.import.wizard");

  const grouped = useMemo(
    () =>
      IMPORT_FIELD_GROUPS.map((group) => ({
        group,
        items: columns.filter((column) => fieldGroup(column.field) === group),
      })).filter((entry) => entry.items.length > 0),
    [columns],
  );

  const chosen = useMemo(
    () => columns.filter((column) => selected.has(column.field)),
    [columns, selected],
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {mode === "update" ? t("fieldsHintUpdate") : t("fieldsHintAdd")}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-border bg-card">
          <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("fieldsAvailable")}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {t("fieldsAvailableCount", { count: columns.length })}
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto px-2 py-2">
            {grouped.map(({ group, items }) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`groups.${group}`)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((column) => {
                    const active = selected.has(column.field);
                    const locked = pinned.includes(column.field);
                    return (
                      <button
                        key={column.field}
                        type="button"
                        disabled={locked}
                        onClick={() => onToggle(column.field)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors",
                          active
                            ? "border-primary/60 bg-primary/10 text-foreground"
                            : "border-input bg-background text-muted-foreground hover:bg-accent",
                          locked && "cursor-default opacity-70",
                        )}
                        aria-pressed={active}
                      >
                        {active ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        <span>{column.header}</span>
                        {column.required ? (
                          <span className="text-destructive" aria-hidden>
                            *
                          </span>
                        ) : null}
                        {locked ? <Lock className="h-3 w-3 opacity-60" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>


        <div className="flex flex-col rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex items-baseline gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("fieldsChosen")}
              </p>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {chosen.length}/{columns.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSelectAll}
                className="cursor-pointer rounded-md px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10"
              >
                {t("fieldsSelectAll")}
              </button>
              <button
                type="button"
                onClick={onRequiredOnly}
                className="cursor-pointer rounded-md px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10"
              >
                {t("fieldsRequiredOnly")}
              </button>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto px-3 py-2">
            {chosen.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("fieldsEmpty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {chosen.map((column) => {
                  const locked = pinned.includes(column.field);
                  return (
                    <li
                      key={column.field}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1"
                    >
                      <span className="flex items-center gap-1.5 text-xs text-foreground">
                        {column.header}
                        {column.required ? (
                          <span className="text-destructive" aria-hidden>
                            *
                          </span>
                        ) : null}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {column.example ? `${t("fieldsExample")}: ${column.example}` : ""}
                        </span>
                      </span>
                      {locked ? (
                        <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggle(column.field)}
                          aria-label={t("fieldsRemove", { field: column.header })}
                          className="cursor-pointer rounded-md p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
