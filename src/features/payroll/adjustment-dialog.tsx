"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { dayGridLabel } from "./payroll-formulas";
import { EDITOR_ADJUSTMENT_STATUSES, particularForAdjustment } from "./payroll-particulars";
import type { PayrollAdjustRequest } from "./payroll-grid";
import type { AdjustmentStatus } from "./payroll-rules-engine";
import type { PayrollAdjustmentCell } from "./payroll-types";
import { usePayrollAdjustmentAudit } from "./use-payroll";

const STATUS_HEX: Record<AdjustmentStatus, string> = {
  auto: "#94a3b8",
  "12": "#9aa4ad",
  "3h": "#fbbf24",
  half: "#22d3ee",
  actual: "#86efac",
  off: "#34d399",
  absent: "#ef4444",
  abs_lh: "#f472b6",
  abs_lo: "#fda4af",
  sick: "#f59e0b",
  accident: "#a3e635",
  vehicle: "#a5b4fc",
  custom: "#c084fc",
};

export type AdjustmentDialogState = PayrollAdjustRequest;

const PANEL_WIDTH = 340;

function clampPanel(anchor: { top: number; left: number; width: number; height: number }, height: number) {
  const left = Math.min(Math.max(8, anchor.left + anchor.width + 8), window.innerWidth - PANEL_WIDTH - 8);
  const top = Math.min(Math.max(8, anchor.top), window.innerHeight - height - 8);
  return { left, top, width: PANEL_WIDTH };
}

function positionFromEl(el: HTMLElement, height: number) {
  const rect = el.getBoundingClientRect();
  return clampPanel(
    { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    height,
  );
}

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
  const panelRef = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<AdjustmentStatus>("auto");
  const [customHours, setCustomHours] = useState("8");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [pos, setPos] = useState({ left: 80, top: 80, width: PANEL_WIDTH });

  useEffect(() => {
    if (!state) return;
    setChoice("auto");
    setReason(state.note ?? "");
    setTouched(false);
    const hours = state.cells.find((c) => c.hours != null)?.hours ?? state.context?.hours;
    if (hours != null) setCustomHours(String(hours));
  }, [state]);

  useLayoutEffect(() => {
    if (!state) return;
    const height = panelRef.current?.offsetHeight ?? 420;
    const place = () => {
      const nextHeight = panelRef.current?.offsetHeight ?? height;
      if (state.anchorEl && document.contains(state.anchorEl)) {
        setPos(positionFromEl(state.anchorEl, nextHeight));
        return;
      }
      setPos(clampPanel(state.anchor, nextHeight));
    };
    place();
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [state, choice, customHours]);

  useEffect(() => {
    if (!state || pending) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target)) return;
      onCancel();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [state, pending, onCancel]);

  const resolved = useMemo(() => {
    if (!state) return [];
    const hours = choice === "custom" ? Math.min(24, Math.max(0, Number(customHours) || 0)) : null;
    return state.cells.map((cell) => ({
      ...cell,
      status: choice,
      hours: choice === "custom" ? hours : cell.hours,
    }));
  }, [state, choice, customHours]);

  const willChange = useMemo(() => {
    if (!state) return { change: 0, same: 0 };
    let change = 0;
    let same = 0;
    for (let i = 0; i < state.cells.length; i += 1) {
      const before = state.cells[i];
      const after = resolved[i];
      if (!after) continue;
      if (before.status === after.status && (before.hours ?? null) === (after.hours ?? null) && choice !== "auto") {
        same += 1;
      } else if (choice === "auto" && before.status === "auto") {
        same += 1;
      } else {
        change += 1;
      }
    }
    return { change, same };
  }, [state, resolved, choice]);

  if (!state) return null;

  const reasonMissing = touched && reason.trim() === "";
  const customInvalid = choice === "custom" && !(Number(customHours) >= 0 && Number(customHours) <= 24);
  const currentHours = state.context?.hours ?? 0;
  const autoLabel = state.auto
    ? `${dayGridLabel(state.auto.status, state.auto.hours)}${
        state.auto.ruleIndex != null
          ? ` (${t("ruleN", { n: state.auto.ruleIndex + 1 })}${state.auto.ruleLabel ? ` · ${state.auto.ruleLabel}` : ""})`
          : ""
      }`
    : "—";

  const title =
    state.mode === "fill"
      ? t("fillTitle", { count: state.cells.length })
      : state.mode === "paste"
        ? t("pasteTitle", { count: state.cells.length })
        : state.cells.length > 1
          ? t("multiTitle", { count: state.cells.length })
          : t("title");

  const optionLabel = (status: AdjustmentStatus) => {
    if (status === "auto") return t("automatic");
    if (status === "actual") return particularForAdjustment("actual", currentHours);
    if (status === "custom") {
      const hours = Math.min(24, Math.max(0, Number(customHours) || 0));
      return particularForAdjustment("custom", hours);
    }
    return particularForAdjustment(status);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      className="fixed z-50 origin-(--transform-origin) rounded-lg border border-border bg-popover p-3 text-sm shadow-md ring-1 ring-foreground/10 duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      <p className="text-[13px] font-semibold">{title}</p>
      {state.context ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {state.context.riderName} · {state.context.amId} · {state.context.date}
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("riders", { count: state.riderCount })} · {t("days", { count: state.dayCount })} ·{" "}
          {t("cells", { count: state.cells.length })}
        </p>
      )}
      {state.context ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {state.context.zone} ({state.context.zoneCategory}) · {t("ordersN", { n: state.context.orders })} ·{" "}
          {t("hoursN", { n: state.context.hours })}
        </p>
      ) : null}
      <p className="mt-1 text-[11px]">
        <span className="text-muted-foreground">{t("automatic")}: </span>
        <span className="font-semibold">{autoLabel}</span>
      </p>
      {state.note ? <p className="mt-1 text-[10px] text-muted-foreground">{state.note}</p> : null}
      {state.cells.length === 1 ? (
        <AdjustmentHistory driverId={state.cells[0]!.driverId} date={state.cells[0]!.date} />
      ) : null}

      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pe-0.5">
        {EDITOR_ADJUSTMENT_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={choice === status}
            onClick={() => setChoice(status)}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md border px-2 text-start text-[11px] font-semibold transition-colors",
              choice === status
                ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {status === "auto" ? (
              <RotateCcw className="size-3 shrink-0" />
            ) : (
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: STATUS_HEX[status] }} />
            )}
            <span className="truncate">{optionLabel(status)}</span>
          </button>
        ))}
      </div>

      {choice === "custom" ? (
        <div className="mt-2 flex items-center gap-2">
          <Label htmlFor="payroll-adjust-hours" className="text-[11px]">
            {t("customHours")}
          </Label>
          <Input
            id="payroll-adjust-hours"
            className="h-9 w-20"
            inputMode="decimal"
            value={customHours}
            onChange={(e) => setCustomHours(e.target.value)}
          />
        </div>
      ) : null}

      {state.cells.length > 1 ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {t("willChange", { change: willChange.change, same: willChange.same })}
        </p>
      ) : null}

      <div className="mt-2 space-y-1">
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
        {reasonMissing ? <p className="text-[10px] text-destructive">{t("reasonRequired")}</p> : null}
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("auditHint")}
      </p>

      <div className="mt-3 flex justify-end gap-2">
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
      </div>
    </div>
  );
}

function AdjustmentHistory({ driverId, date }: { driverId: string; date: string }) {
  const t = useTranslations("pages.payroll.adjust");
  const audit = usePayrollAdjustmentAudit({ from: date, to: date, driverId });
  const rows = audit.data ?? [];
  const latest = rows[0];
  return (
    <div className="mt-2 space-y-1">
      {latest ? (
        <p className="text-[10px] text-muted-foreground">
          {t("lastEdited", { who: latest.actorName, when: latest.adjustedAt })}
        </p>
      ) : null}
      <p className="text-[11px] font-semibold">{t("history")}</p>
      <div className="max-h-24 space-y-1 overflow-y-auto">
        {audit.isLoading ? (
          <p className="text-[10px] text-muted-foreground">{t("historyLoading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          rows.map((row) => (
            <p key={row.id} className="text-[10px] leading-4 text-muted-foreground">
              <span className="font-semibold text-foreground">{row.adjustedAt}</span>
              {" · "}
              {row.actorName}
              {" · "}
              {row.adjustedStatus}
              {row.adjustedHours != null ? ` · ${row.adjustedHours}h` : ""}
              {row.reason ? ` — ${row.reason}` : ""}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

export const ADJUSTMENT_DIALOG_STATUSES = EDITOR_ADJUSTMENT_STATUSES;
