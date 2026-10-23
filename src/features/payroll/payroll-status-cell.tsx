"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { payrollStatusChoiceFromLabel } from "./payroll-status-options";
import { usePayrollStatusEditor } from "./payroll-status-context";
import { RiderStatusPill } from "./rider-status-pill";
import { resolveRiderStatus } from "./payroll-rider-columns";
import type { PayrollRiderRow } from "./payroll-types";

function statusError(message: string): "statusEdit.invalid" | "statusEdit.driverNotFound" | "statusEdit.saveFailed" {
  if (message === "invalid_status") return "statusEdit.invalid";
  if (message === "driver_not_found") return "statusEdit.driverNotFound";
  return "statusEdit.saveFailed";
}

export function PayrollStatusCell({
  row,
  today,
  canEdit = false,
}: {
  row: PayrollRiderRow;
  today?: string;
  canEdit?: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const editor = usePayrollStatusEditor();
  const editable = canEdit && editor.canEdit;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const status = resolveRiderStatus(row, today);
  const busy = editor.savingId !== null;

  if (!editable) return <RiderStatusPill row={row} today={today} />;

  async function commit(choice: { key: string; label: string } | null) {
    try {
      await editor.save(row.driverId, choice);
      toast.success(t("statusEdit.saved"));
      setDraft("");
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(t(statusError(message)));
    }
  }

  function addDraft() {
    const choice = payrollStatusChoiceFromLabel(draft);
    if (!choice) {
      toast.error(t("statusEdit.invalid"));
      return;
    }
    void commit(choice);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex rounded-full p-0"
        disabled={busy}
        aria-label={t("statusEdit.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <RiderStatusPill row={row} today={today} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(260px,92vw)] origin-(--transform-origin) p-3"
      >
        <p className="mb-2 text-xs font-semibold">{t("statusEdit.title")}</p>
        <div className="max-h-52 space-y-1 overflow-auto">
          {editor.labels.map((label) => {
            const selected = label.toLowerCase() === status.label.toLowerCase();
            return (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => {
                  const choice = payrollStatusChoiceFromLabel(label);
                  if (choice) void commit(choice);
                }}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-md border px-2 text-start text-xs transition-colors",
                  selected
                    ? "border-emerald-500 bg-emerald-100 font-semibold text-emerald-900 ring-1 ring-emerald-400/50"
                    : "border-border bg-muted/30 text-muted-foreground",
                )}
              >
                {selected ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-1">
          <Input
            className="h-9"
            value={draft}
            maxLength={40}
            disabled={busy}
            placeholder={t("statusEdit.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDraft();
              }
            }}
          />
          <Button type="button" className="h-9 shrink-0" disabled={busy} onClick={addDraft}>
            {t("statusEdit.add")}
          </Button>
        </div>
        {row.statusOverride ? (
          <Button
            type="button"
            variant="outline"
            className="mt-2 h-9 w-full"
            disabled={busy}
            onClick={() => void commit(null)}
          >
            {t("statusEdit.automatic")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
