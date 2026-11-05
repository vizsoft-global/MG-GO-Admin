"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query/query-keys";
import { notifyPayrollWrite } from "./payroll-sync";

/**
 * `idle → pending → saved | error`, held per cell.
 *
 * The sheet paints the state inside the cell (a spinner, then a tick for a
 * second, or a destructive outline naming the server's reason), so an operator
 * can see which of forty cells is still in flight.
 */
export type PayrollCellState = "idle" | "pending" | "saved" | "error";

export type PayrollCellStatus = { state: PayrollCellState; error?: string };

const SAVED_VISIBLE_MS = 1_000;

/**
 * One write path for every payroll and HR cell.
 *
 * Optimistic patch → callable → invalidate `["payroll", …]` (and notify the other
 * tab). On a refusal the patch is rolled back and the cell keeps the operator's
 * text with the server's reason, which is the difference between "your 3 was
 * rejected because…" and the old silent revert to 0.
 */
export function usePayrollCellMutation<TVars, TResult>(args: {
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** Stable identity of the cell, e.g. `${driverId}:${field}`. */
  cellOf: (vars: TVars) => string;
  /** Apply the optimistic value and return the undo. */
  patch?: (vars: TVars) => () => void;
  /** Human sentence for a failure; receives the server code when it has one. */
  failedMessage: (code?: string) => string;
}) {
  const client = useQueryClient();
  const [cells, setCells] = useState<Record<string, PayrollCellStatus>>({});
  const timers = useRef<Record<string, number>>({});

  const clearTimer = useCallback((cell: string) => {
    const timer = timers.current[cell];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete timers.current[cell];
    }
  }, []);

  const markSaved = useCallback(
    (cell: string) => {
      clearTimer(cell);
      setCells((current) => ({ ...current, [cell]: { state: "saved" } }));
      timers.current[cell] = window.setTimeout(() => {
        setCells((current) => {
          if (current[cell]?.state !== "saved") return current;
          const next = { ...current };
          delete next[cell];
          return next;
        });
        delete timers.current[cell];
      }, SAVED_VISIBLE_MS);
    },
    [clearTimer],
  );

  const markFailed = useCallback(
    (cell: string, error?: string) => {
      clearTimer(cell);
      setCells((current) => ({ ...current, [cell]: { state: "error", error } }));
    },
    [clearTimer],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of Object.values(pending)) window.clearTimeout(timer);
    };
  }, []);

  const mutation = useMutation({
    mutationFn: args.mutationFn,
    onMutate: (vars: TVars) => {
      const cell = args.cellOf(vars);
      clearTimer(cell);
      setCells((current) => ({ ...current, [cell]: { state: "pending" } }));
      const rollback = args.patch?.(vars);
      return { cell, rollback };
    },
    onSuccess: (result, _vars, context) => {
      const cell = context?.cell;
      if (!cell) return;
      const failure =
        result && typeof result === "object" && "error" in result
          ? (result as { error?: string }).error
          : undefined;
      if (failure) {
        context?.rollback?.();
        markFailed(cell, failure);
        toast.error(args.failedMessage(failure));
        return;
      }
      markSaved(cell);
      notifyPayrollWrite();
      void client.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    },
    onError: (error, _vars, context) => {
      const cell = context?.cell;
      context?.rollback?.();
      const code = error instanceof Error ? error.message : undefined;
      if (cell) markFailed(cell, code);
      toast.error(args.failedMessage(code));
    },
  });

  const cellState = useCallback(
    (cell: string): PayrollCellStatus => cells[cell] ?? { state: "idle" },
    [cells],
  );

  return { mutation, cells, cellState, markSaved, markFailed };
}
