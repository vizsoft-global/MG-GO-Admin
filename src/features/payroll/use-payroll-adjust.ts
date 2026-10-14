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

const ADJUST_ERROR_KEYS = [
  "reason_required",
  "no_cells",
  "too_many_cells",
  "not_authorized",
  "date_out_of_range",
  "invalid_cell",
  "invalid_cells",
  "unknown_driver",
  "cell_out_of_scope",
  "invalid_hours",
  "invalid_custom_hours",
] as const;

function adjustErrorKey(code: string): string {
  if ((ADJUST_ERROR_KEYS as readonly string[]).includes(code)) return code;
  const match = ADJUST_ERROR_KEYS.find((key) => code.includes(key));
  return match ?? "unknown";
}

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
  type AdjustBatch = { restore: PayrollAdjustmentCell[]; applied: PayrollAdjustmentCell[] };
  const [undoStack, setUndoStack] = useState<AdjustBatch[]>([]);
  const [redoStack, setRedoStack] = useState<AdjustBatch[]>([]);
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

  const pushUndo = useCallback((batch: AdjustBatch) => {
    if (!batch.restore.length) return;
    setUndoStack((stack) => [...stack, batch].slice(-UNDO_LIMIT));
    setRedoStack([]);
  }, []);

  const confirm = useCallback(
    (input: { cells: PayrollAdjustmentCell[]; reason: string }) => {
      if (apply.isPending) return;
      const snapshot = input.reason === "undo" || input.reason === "redo" ? [] : beforeRef.current;
      apply.mutate(input, {
        onSuccess: (result) => {
          if ("error" in result) {
            toast.error(t(`adjust.errors.${adjustErrorKey(result.error)}`));
            return;
          }
          if (snapshot.length) pushUndo({ restore: snapshot, applied: input.cells });
          beforeRef.current = [];
          toast.success(
            input.reason === "undo"
              ? t("adjust.undone", { count: result.applied })
              : input.reason === "redo"
                ? t("adjust.redone", { count: result.applied })
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
      { cells: batch.restore, reason: "undo" },
      {
        onSuccess: (result) => {
          if ("error" in result) {
            toast.error(t(`adjust.errors.${adjustErrorKey(result.error)}`));
            return;
          }
          setUndoStack((stack) => stack.slice(0, -1));
          setRedoStack((stack) => [...stack, batch].slice(-UNDO_LIMIT));
          toast.success(t("adjust.undone", { count: result.applied }));
        },
        onError: () => toast.error(t("adjust.errors.unknown")),
      },
    );
  }, [adjust, apply, t, undoStack]);

  const redo = useCallback(() => {
    const batch = redoStack[redoStack.length - 1];
    if (!batch || apply.isPending || adjust) return;
    apply.mutate(
      { cells: batch.applied, reason: "redo" },
      {
        onSuccess: (result) => {
          if ("error" in result) {
            toast.error(t(`adjust.errors.${adjustErrorKey(result.error)}`));
            return;
          }
          setRedoStack((stack) => stack.slice(0, -1));
          setUndoStack((stack) => [...stack, batch].slice(-UNDO_LIMIT));
          toast.success(t("adjust.redone", { count: result.applied }));
        },
        onError: () => toast.error(t("adjust.errors.unknown")),
      },
    );
  }, [adjust, apply, t, redoStack]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (adjust || apply.isPending) return;
      const key = event.key.toLowerCase();
      const redoKey = key === "y" || (key === "z" && event.shiftKey);
      const undoKey = key === "z" && !event.shiftKey;
      if (redoKey) {
        if (redoStack.length === 0) return;
        event.preventDefault();
        redo();
        return;
      }
      if (!undoKey || undoStack.length === 0) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjust, apply.isPending, redo, redoStack.length, undo, undoStack.length]);

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
    redo,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    pending: apply.isPending,
    onNotice,
  };
}
