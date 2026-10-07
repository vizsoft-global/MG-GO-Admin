"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { AdjustmentDialogState } from "./adjustment-dialog";
import type { PayrollAdjustRequest } from "./payroll-grid";
import { cellsFromSelection } from "./payroll-snapshot";
import type { PayrollAdjustmentCell, PayrollRiderRow } from "./payroll-types";
import { useApplyPayrollAdjustments } from "./use-payroll";

const UNDO_LIMIT = 20;

type AdjustInput = {
  driverId: string;
  date: string;
  text: string;
  currentHours?: number;
  beforeStatus?: PayrollAdjustmentCell["status"];
  beforeHours?: number | null;
};

export function usePayrollAdjustSession() {
  const t = useTranslations("pages.payroll");
  const apply = useApplyPayrollAdjustments();
  const [adjust, setAdjust] = useState<AdjustmentDialogState | null>(null);
  const [undoStack, setUndoStack] = useState<PayrollAdjustmentCell[][]>([]);
  const lastAnchor = useRef<DOMRect | null>(null);
  const lastAnchorEl = useRef<HTMLElement | null>(null);
  const beforeRef = useRef<PayrollAdjustmentCell[]>([]);

  const rememberAnchor = useCallback((el: HTMLElement | null) => {
    lastAnchorEl.current = el;
    lastAnchor.current = el?.getBoundingClientRect() ?? null;
  }, []);

  const openRequest = useCallback((request: PayrollAdjustRequest) => {
    beforeRef.current = request.before ?? [];
    setAdjust(request);
  }, []);

  const openAdjust = useCallback(
    (
      inputs: ReadonlyArray<AdjustInput>,
      mode: PayrollAdjustRequest["mode"],
      emptyMessage: string,
      _first?: { row: PayrollRiderRow; dayIndex: number },
      extras?: Pick<PayrollAdjustRequest, "auto" | "context" | "note">,
    ) => {
      void _first;
      const { cells, before, rejected } = cellsFromSelection(
        inputs.map((cell) => ({
          driverId: cell.driverId,
          date: cell.date,
          text: cell.text,
          currentHours: cell.currentHours ?? 0,
          beforeStatus: cell.beforeStatus,
          beforeHours: cell.beforeHours,
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
      openRequest({
        cells,
        before,
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
    [openRequest, t],
  );

  const pushUndo = useCallback((batch: PayrollAdjustmentCell[]) => {
    if (!batch.length) return;
    setUndoStack((stack) => [...stack, batch].slice(-UNDO_LIMIT));
  }, []);

  const confirm = useCallback(
    (input: { cells: PayrollAdjustmentCell[]; reason: string }) => {
      const snapshot = input.reason === "undo" ? [] : beforeRef.current;
      apply.mutate(input, {
        onSuccess: (result) => {
          if ("error" in result) {
            const known = ["reason_required", "no_cells", "too_many_cells", "not_authorized"];
            const key = known.includes(result.error) ? result.error : "unknown";
            toast.error(t(`adjust.errors.${key}`));
            return;
          }
          if (snapshot.length) pushUndo(snapshot);
          beforeRef.current = [];
          toast.success(
            input.reason === "undo"
              ? t("adjust.undone", { count: result.applied })
              : t("adjust.applied", { count: result.applied }),
          );
          setAdjust(null);
        },
        onError: () => toast.error(t("adjust.errors.unknown")),
      });
    },
    [apply, pushUndo, t],
  );

  const undo = useCallback(() => {
    const batch = undoStack[undoStack.length - 1];
    if (!batch || apply.isPending || adjust) return;
    apply.mutate(
      { cells: batch, reason: "undo" },
      {
        onSuccess: (result) => {
          if ("error" in result) {
            const known = ["reason_required", "no_cells", "too_many_cells", "not_authorized"];
            const key = known.includes(result.error) ? result.error : "unknown";
            toast.error(t(`adjust.errors.${key}`));
            return;
          }
          setUndoStack((stack) => stack.slice(0, -1));
          toast.success(t("adjust.undone", { count: result.applied }));
        },
        onError: () => toast.error(t("adjust.errors.unknown")),
      },
    );
  }, [adjust, apply, t, undoStack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (adjust || apply.isPending || undoStack.length === 0) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjust, apply.isPending, undo, undoStack.length]);

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
    openRequest,
    rememberAnchor,
    lastAnchor,
    lastAnchorEl,
    confirm,
    cancel,
    undo,
    undoCount: undoStack.length,
    pending: apply.isPending,
    onNotice,
  };
}
