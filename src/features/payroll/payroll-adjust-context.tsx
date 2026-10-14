"use client";

import { createContext, useContext, type ReactNode } from "react";
import { AdjustmentDialog } from "./adjustment-dialog";
import { usePayrollAdjustSession } from "./use-payroll-adjust";

type PayrollAdjustApi = ReturnType<typeof usePayrollAdjustSession>;

const PayrollAdjustContext = createContext<PayrollAdjustApi | null>(null);

export function PayrollAdjustProvider({ children }: { children: ReactNode }) {
  const session = usePayrollAdjustSession();
  return (
    <PayrollAdjustContext.Provider value={session}>
      {children}
      <AdjustmentDialog
        state={session.adjust}
        pending={session.pending}
        onCancel={session.cancel}
        onConfirm={session.confirm}
      />
    </PayrollAdjustContext.Provider>
  );
}

export function usePayrollAdjust(): PayrollAdjustApi {
  const session = useContext(PayrollAdjustContext);
  if (!session) {
    throw new Error("usePayrollAdjust must be used inside PayrollAdjustProvider");
  }
  return session;
}
