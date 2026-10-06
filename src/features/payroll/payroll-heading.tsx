"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Check, Columns3, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  columnHiddenIn,
  headingKeysFor,
  resolveColumnLabel,
  type PayrollColumnConfigRow,
  type PayrollHeadingView,
} from "./payroll-column-config";
import { useSavePayrollColumnConfig } from "./use-payroll";

export function PayrollHeadingLabel({
  columnKey,
  fallback,
  config,
  canManage,
}: {
  columnKey: string;
  fallback: string;
  config: ReadonlyMap<string, PayrollColumnConfigRow>;
  canManage: boolean;
}) {
  const t = useTranslations("pages.payroll.headings");
  const save = useSavePayrollColumnConfig();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const label = resolveColumnLabel(columnKey, fallback, config);
  const current = config.get(columnKey);

  function commit(next: string) {
    const trimmed = next.trim();
    setEditing(false);
    if (trimmed === label) return;
    save.mutate({
      columnKey,
      label: trimmed === fallback || trimmed === "" ? null : trimmed,
      hiddenViews: current?.hiddenViews ?? [],
    });
  }

  if (!canManage) return <span>{label}</span>;
  if (editing) {
    return (
      <Input
        autoFocus
        className="h-7 w-[7.5rem] px-1.5 text-[11px]"
        value={draft}
        aria-label={t("rename")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        className="text-start font-semibold"
        title={t("renameHint")}
        onDoubleClick={() => {
          setDraft(label);
          setEditing(true);
        }}
      >
        {label}
      </button>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        aria-label={t("rename")}
        onClick={() => {
          setDraft(label);
          setEditing(true);
        }}
      >
        <Pencil className="size-3" />
      </button>
    </span>
  );
}

export function PayrollColumnsMenu({
  view,
  config,
  fallbackLabel,
  canManage,
}: {
  view: PayrollHeadingView;
  config: ReadonlyMap<string, PayrollColumnConfigRow>;
  fallbackLabel: (key: string) => string;
  canManage: boolean;
}) {
  const t = useTranslations("pages.payroll.headings");
  const save = useSavePayrollColumnConfig();
  const keys = headingKeysFor(view);
  const [open, setOpen] = useState(false);

  const rows = useMemo(
    () =>
      keys.map((key) => ({
        key,
        label: resolveColumnLabel(key, fallbackLabel(key), config),
        hidden: columnHiddenIn(key, view, config),
      })),
    [keys, config, fallbackLabel, view],
  );

  if (!canManage) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-semibold hover:bg-muted/50">
        <Columns3 className="size-3.5" />
        {t("columns")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(280px,92vw)] origin-(--transform-origin) p-3">
        <p className="text-xs font-semibold">{t("title")}</p>
        <p className="mb-2 text-[10px] text-muted-foreground">{t("hint")}</p>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {rows.map((row) => {
            const current = config.get(row.key);
            const hiddenViews = new Set(current?.hiddenViews ?? []);
            return (
              <div key={row.key} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={!row.hidden}
                  onClick={() => {
                    if (row.hidden) hiddenViews.delete(view);
                    else hiddenViews.add(view);
                    save.mutate({
                      columnKey: row.key,
                      label: current?.label ?? null,
                      hiddenViews: [...hiddenViews],
                    });
                  }}
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-sm border",
                    !row.hidden
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border bg-muted/30 text-transparent",
                  )}
                  aria-label={row.hidden ? t("show") : t("hide")}
                >
                  <Check className="size-3" />
                </button>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{row.label}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function stickyIdentityStyle(
  columnId: string,
  offset: number,
): { className: string; style: CSSProperties } | null {
  if (columnId !== "amId" && columnId !== "mgId" && columnId !== "name") return null;
  const width = columnId === "name" ? 190 : 64;
  return {
    className: "sticky z-20 bg-card",
    style: { insetInlineStart: offset, minWidth: width, width },
  };
}

export function stickyIdentityOffset(columnId: string): number {
  if (columnId === "name") return 190;
  if (columnId === "amId" || columnId === "mgId") return 64;
  return 0;
}
