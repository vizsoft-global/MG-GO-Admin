"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";

type PayrollActions = { exportNow?: () => void; clearNow?: () => void };

type PayrollActionsBridge = {
  register: (actions: PayrollActions | null) => void;
  runExport: () => void;
  runClear: () => void;
};

const PayrollActionsContext = createContext<PayrollActionsBridge | null>(null);

/**
 * Lets a page shell own the top action buttons while the table that knows how to
 * export (or clear) registers the work.
 *
 * HR Payroll is one page with one table; the export lives inside the sheet and
 * the shell renders the button. This bridge is the same trick
 * `combined-export-bridge` already plays for Combined Payroll, generalised so the
 * six action buttons can be one shared component. It holds the handlers in a ref
 * — pressing a button is an event, not a render, so nothing here needs state.
 */
export function PayrollActionsBridgeProvider({ children }: { children: ReactNode }) {
  const handlers = useRef<PayrollActions>({});
  const value = useMemo<PayrollActionsBridge>(
    () => ({
      register: (next) => {
        handlers.current = next ?? {};
      },
      runExport: () => handlers.current.exportNow?.(),
      runClear: () => handlers.current.clearNow?.(),
    }),
    [],
  );
  return <PayrollActionsContext.Provider value={value}>{children}</PayrollActionsContext.Provider>;
}

/** The registered actions, or `null` outside a provider. */
export function usePayrollActionsBridge(): PayrollActionsBridge | null {
  return useContext(PayrollActionsContext);
}

/**
 * Register the page's export/clear handlers.
 *
 * A `ref` rather than two functions: the sheet's handlers are re-created on every
 * render (they read `view`, the filtered rows and the month), and registering a
 * fresh pair each time would tear the bridge down and rebuild it constantly. The
 * ref is refreshed in an effect, so the bridge keeps one stable pair that always
 * calls the current implementation.
 */
export function useRegisterPayrollActions(ref: RefObject<PayrollActions>) {
  const bridge = useContext(PayrollActionsContext);
  const register = bridge?.register;
  useEffect(() => {
    if (!register) return;
    register({
      exportNow: () => ref.current?.exportNow?.(),
      clearNow: () => ref.current?.clearNow?.(),
    });
    return () => register(null);
  }, [register, ref]);
}
