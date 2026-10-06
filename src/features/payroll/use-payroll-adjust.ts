"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { AdjustmentDialogState } from "./adjustment-dialog";
import type { PayrollAdjustRequest } from "./payroll-grid";
import { cellsFromSelection } from "./payroll-snapshot";
import type { PayrollAdjustmentCell, PayrollRiderRow } from "./payroll-types";
import { useApplyPayrollAdjustments } from "./use-payroll";

export function usePayrollAdjustSession() {
  const t = useTranslations("pages.payroll");
  const apply = useApplyPayrollAdjustments();
  const [adjust, setAdjust] = useState<AdjustmentDialogState | null>(null);
  const lastAnchor = useRef<DOMRect | null>(null);
  const lastAnchorEl = useRef<HTMLElement | null>(null);

  const rememberAnchor = useCallback((el: HTMLElement | null) => {
    lastAnchorEl.current = el;
    lastAnchor.current = el?.getBoundingClientRect() ?? null;
  }, []);

  const openAdjust = useCallback(
    (
      inputs: ReadonlyArray<{ driverId: string; date: string; text: string; currentHours?: number }>,
      mode: PayrollAdjustRequest["mode"],
      emptyMessage: string,
      _first?: { row: PayrollRiderRow; dayIndex: number },
      extras?: Pick<PayrollAdjustRequest, "auto" | "context" | "note">,
    ) => {
      void _first;
      const { cells, rejected } = cellsFromSelection(
        inputs.map((cell) => ({
          driverId: cell.driverId,
          date: cell.date,
          text: cell.text,
          currentHours: cell.currentHours ?? 0,
        })),
      );
      if (!cells.length) {
        if (emptyMessage) toast.warning(emptyMessage);
        return;
      }
      if (rejected > 0) toast.warning(t("adjust.someSkipped", { count: rejected }));
      const ridersTouched = new Set(cells.map((c) => c.driverId));
      const datesTouched = new Set(cells.map((c) => c.date));
      const rect = lastAnchor.current ?? { top: 80, left: 80, width: 40, height: 28 };
      setAdjust({
        cells,
        riderCount: ridersTouched.size,
        dayCount: datesTouched.size,
        mode,
        anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        anchorEl: lastAnchorEl.current,
        auto: extras?.auto ?? null,
        context: extras?.context ?? null,
        note: extras?.note ?? (mode === "fill" || mode === "paste" ? t("adjust.patternNote") : undefined),
      });
    },
    [t],
  );

  const confirm = useCallback(
    (input: { cells: PayrollAdjustmentCell[]; reason: string }) => {
      apply.mutate(input, {
        onSuccess: (result) => {
          if ("error" in result) {
            const known = ["reason_required", "no_cells", "too_many_cells", "not_authorized"];
            const key = known.includes(result.error) ? result.error : "unknown";
            toast.error(t(`adjust.errors.${key}`));
            return;
          }
          toast.success(t("adjust.applied", { count: result.applied }));
          setAdjust(null);
        },
        onError: () => toast.error(t("adjust.errors.unknown")),
      });
    },
    [apply, t],
  );

  const cancel = useCallback(() => {
    if (!apply.isPending) setAdjust(null);
  }, [apply.isPending]);

  const onNotice = useCallback((message: string) => {
    if (message) toast.warning(message);
  }, []);

  return {
    adjust,
    setAdjust,
    openAdjust,
    rememberAnchor,
    lastAnchor,
    lastAnchorEl,
    confirm,
    cancel,
    pending: apply.isPending,
    onNotice,
  };
}
