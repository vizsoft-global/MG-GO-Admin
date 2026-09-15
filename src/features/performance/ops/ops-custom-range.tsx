"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  assertCustomOpsRange,
  customRangeDraft,
  fillCustomPreset,
  formatOpsCustomPill,
} from "../performance-ops-formulas";

export function OpsCustomRangePopover({
  selected,
  today,
  appliedFrom,
  appliedTo,
  onApply,
}: {
  selected: boolean;
  today: string;
  appliedFrom: string | null;
  appliedTo: string | null;
  onApply: (from: string, to: string) => void;
}) {
  const t = useTranslations("pages.performance.ops");
  const [open, setOpen] = useState(false);
  const draftDefault = customRangeDraft(today);
  const [from, setFrom] = useState(appliedFrom ?? draftDefault.from);
  const [to, setTo] = useState(appliedTo ?? draftDefault.to);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = appliedFrom && appliedTo
      ? { from: appliedFrom, to: appliedTo }
      : customRangeDraft(today);
    setFrom(next.from);
    setTo(next.to);
    setErr(null);
  }, [open, appliedFrom, appliedTo, today]);

  const label =
    selected && appliedFrom && appliedTo
      ? formatOpsCustomPill(appliedFrom, appliedTo)
      : t("range.custom");

  function apply() {
    try {
      assertCustomOpsRange(from, to, today);
      setErr(null);
      onApply(from, to);
      setOpen(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : "custom_range_incomplete";
      setErr(t(`customErr.${code}`));
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErr(null);
      }}
    >
      <PopoverTrigger
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors",
          selected
            ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <CalendarRange className={cn("h-3 w-3 shrink-0", selected ? "text-emerald-900" : "opacity-50")} />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(340px,92vw)] origin-(--transform-origin) p-3">
        <p className="mb-2 text-xs font-semibold">{t("customTitle")}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-[10px] font-medium text-muted-foreground">
            {t("customFrom")}
            <Input
              type="date"
              value={from}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-9"
            />
          </label>
          <label className="min-w-0 text-[10px] font-medium text-muted-foreground">
            {t("customTo")}
            <Input
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-9"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["14", "30", "90", "quarter"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="h-8 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted/40"
              onClick={() => {
                const next = fillCustomPreset(kind, today);
                setFrom(next.from);
                setTo(next.to);
                setErr(null);
              }}
            >
              {t(`customPreset.${kind}`)}
            </button>
          ))}
        </div>
        {err ? <p className="mt-2 text-[11px] text-destructive">{err}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs"
            onClick={() => setOpen(false)}
          >
            {t("customCancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
            onClick={apply}
          >
            {t("customApply")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
