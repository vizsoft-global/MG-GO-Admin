"use client";

import { createContext, useContext, type ReactNode } from "react";
import { statusFilterLabels } from "./payroll-status-options";

export type PayrollStatusChoice = { key: string; label: string };

type PayrollStatusEditor = {
  canEdit: boolean;
  labels: readonly string[];
  savingId: string | null;
  save: (driverId: string, choice: PayrollStatusChoice | null) => Promise<void>;
};

const PayrollStatusContext = createContext<PayrollStatusEditor>({
  canEdit: false,
  labels: statusFilterLabels([]),
  savingId: null,
  save: async () => {
    throw new Error("status_editor_missing");
  },
});

export function PayrollStatusContextProvider({
  value,
  children,
}: {
  value: PayrollStatusEditor;
  children: ReactNode;
}) {
  return <PayrollStatusContext.Provider value={value}>{children}</PayrollStatusContext.Provider>;
}

export function usePayrollStatusFilterList(): readonly string[] {
  return useContext(PayrollStatusContext).labels;
}

export function usePayrollStatusEditor(): PayrollStatusEditor {
  return useContext(PayrollStatusContext);
}
