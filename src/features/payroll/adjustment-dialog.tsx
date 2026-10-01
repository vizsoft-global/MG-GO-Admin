"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarRange, Hand, Info, Loader2, RotateCcw, Users } from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ADJUSTMENT_STATUSES, type AdjustmentStatus } from "./payroll-rules-engine";
import type { PayrollAdjustmentCell } from "./payroll-types";

/** The SOP list, in the order the sheet lists it. `auto` first = revert. */
const STATUS_ORDER: AdjustmentStatus[] = [
  "auto",
  "12",
  "3h",
  "half",
  "actual",
  "off",
  "absent",
  "abs_lh",
  "abs_lo",
  "sick",
  "accident",
  "vehicle",
  "custom",
];

const STATUS_HEX: Record<AdjustmentStatus, string> = {
  auto: "#94a3b8",
  "12": "#10b981",
  "3h": "#0ea5e9",
  half: "#3b82f6",
  actual: "#8b5cf6",
  off: "#059669",
  absent: "#dc2626",
  abs_lh: "#f97316",
  abs_lo: "#ec4899",
  sick: "#f59e0b",
  accident: "#84cc16",
  vehicle: "#06b6d4",
  custom: "#64748b",
};

export type AdjustmentDialogState = {
  cells: PayrollAdjustmentCell[];
  /** How many distinct riders and days the batch covers, for the footer meta. */
  riderCount: number;
  dayCount: number;
  /** The reason prefilled when the batch came from a paste or a fill. */
  note?: string;
};

/**
 * One reason per batch, and the SOP status list. The reason is required by the
 * server as well (`reason_required`), so an unexplained row is impossible from
 * either side.
 */
export function AdjustmentDialog({
  state,
  pending,
  onCancel,
  onConfirm,
}: {
  state: AdjustmentDialogState | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { cells: PayrollAdjustmentCell[]; reason: string }) => void;
}) {
  const t = useTranslations("pages.payroll.adjust");
  const [choice, setChoice] = useState<AdjustmentStatus | "keep">("keep");
  const [customHours, setCustomHours] = useState("8");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!state) return;
    setChoice("keep");
    setReason(state.note ?? "");
    setTouched(false);
  }, [state]);

  const counts = useMemo(() => {
    const map = new Map<AdjustmentStatus, number>();
    for (const cell of state?.cells ?? []) {
      map.set(cell.status, (map.get(cell.status) ?? 0) + 1);
    }
    return map;
  }, [state?.cells]);

  const resolved = useMemo(() => {
    if (!state) return [];
    if (choice === "keep") return state.cells;
    const hours =
      choice === "custom" ? Math.min(24, Math.max(0, Number(customHours) || 0)) : null;
    return state.cells.map((cell) => ({ ...cell, status: choice, hours }));
  }, [state, choice, customHours]);

  const reasonMissing = touched && reason.trim() === "";
  const customInvalid = choice === "custom" && !(Number(customHours) >= 0 && Number(customHours) <= 24);

  return (
    <Dialog open={state !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent
        className="w-[min(720px,96vw)]"
        showCloseButton
        closeOutside
        aria-describedby={undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="secondary" className="gap-1 font-normal">
              <Users className="size-3.5" />
              {t("riders", { count: state?.riderCount ?? 0 })}
            </Badge>
            <Badge variant="secondary" className="gap-1 font-normal">
              <CalendarRange className="size-3.5" />
              {t("days", { count: state?.dayCount ?? 0 })}
            </Badge>
            <Badge variant="secondary" className="gap-1 font-normal">
              <Hand className="size-3.5" />
              {t("cells", { count: state?.cells.length ?? 0 })}
            </Badge>
          </div>

          {choice === "keep" ? (
            <div className="flex flex-wrap gap-1.5">
              {[...counts.entries()].map(([status, count]) => (
                <span
                  key={status}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] font-semibold"
                >
                  <span
                    className="size-3 rounded-sm"
                    style={{ background: STATUS_HEX[status] }}
                  />
                  {t(`status.${status}`)}
                  <span className="tabular-nums opacity-70">×{count}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("statusLabel")}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <StatusButton
                selected={choice === "keep"}
                label={t("keep")}
                hex="#0f172a"
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => setChoice("keep")}
              />
              {STATUS_ORDER.map((status) => (
                <StatusButton
                  key={status}
                  selected={choice === status}
                  label={t(`status.${status}`)}
                  hex={STATUS_HEX[status]}
                  onClick={() => setChoice(status)}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{t("statusHint")}</p>
          </div>

          {choice === "custom" ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="payroll-adjust-hours" className="text-[11px]">
                {t("customHours")}
              </Label>
              <Input
                id="payroll-adjust-hours"
                className="h-9 w-24"
                inputMode="decimal"
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
              />
              <span className="text-[10px] text-muted-foreground">{t("customHint")}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="payroll-adjust-reason" className="text-[11px]">
              {t("reason")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="payroll-adjust-reason"
              className={cn("h-9", reasonMissing && "border-destructive")}
              value={reason}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              onBlur={() => setTouched(true)}
              onChange={(e) => setReason(e.target.value)}
            />
            {reasonMissing ? (
              <p className="text-[10px] text-destructive">{t("reasonRequired")}</p>
            ) : null}
          </div>

          <p className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("auditHint")}
          </p>
        </div>

        <AppModalFooter
          title={t("title")}
          subtitle={t("subtitle")}
          meta={
            counts.size === 1 && choice === "keep"
              ? t("singleStatus", {
                  status: t(`status.${[...counts.keys()][0] as AdjustmentStatus}`),
                })
              : undefined
          }
        >
          <Button type="button" variant="outline" className="h-9" onClick={onCancel} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={pending || customInvalid}
            onClick={() => {
              setTouched(true);
              if (resolved.length === 0) return;
              if (reason.trim() === "") return;
              onConfirm({ cells: resolved, reason: reason.trim() });
            }}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("apply", { count: resolved.length })}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusButton({
  selected,
  label,
  hex,
  icon,
  onClick,
}: {
  selected: boolean;
  label: string;
  hex: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition-colors",
        selected
          ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {icon ?? <span className="size-3 rounded-sm" style={{ background: hex }} />}
      {label}
    </button>
  );
}

/** Every status the dialog offers, for tests and the settings help text. */
export const ADJUSTMENT_DIALOG_STATUSES = ADJUSTMENT_STATUSES;
