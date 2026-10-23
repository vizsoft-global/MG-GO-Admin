"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  savePayrollIdentity,
  savePayrollOrders,
  type PayrollIdentityField,
} from "./payroll-actions";
import type { PayrollRiderRow } from "./payroll-types";

const INPUT =
  "h-6 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 text-xs text-foreground outline-none transition-colors focus:border-border focus:bg-background";

function cellError(message: string, t: (key: string) => string): string {
  if (message.includes("employee_id_taken")) return t("employeeIdTaken");
  if (message.includes("invalid_employee_id")) return t("invalidEmployeeId");
  if (message.includes("invalid_name")) return t("invalidName");
  if (message.includes("unknown_restaurant")) return t("unknownRestaurant");
  if (message.includes("ambiguous_restaurant")) return t("ambiguousRestaurant");
  if (message.includes("date_out_of_range")) return t("dateOutOfRange");
  if (message.includes("invalid_orders")) return t("invalidOrders");
  if (message.includes("invalid_client_id")) return t("invalidClientId");
  if (message.includes("driver_not_found")) return t("driverNotFound");
  return t("saveFailed");
}

export function payrollIdentityField(columnId: string): PayrollIdentityField | null {
  switch (columnId) {
    case "amId":
      return "employeeId";
    case "name":
      return "fullName";
    case "restaurant":
      return "restaurantName";
    case "restaurantId":
      return "clientId";
    default:
      return null;
  }
}

export function payrollIdentityValue(row: PayrollRiderRow, field: PayrollIdentityField): string {
  switch (field) {
    case "employeeId":
      return row.amId === "—" ? "" : row.amId;
    case "fullName":
      return row.name === "—" ? "" : row.name;
    case "restaurantName":
      return row.restaurant === "—" ? "" : row.restaurant;
    case "clientId":
      return row.restaurantClientId?.trim() ?? "";
    default: {
      const unknown: never = field;
      return unknown;
    }
  }
}

export function hrIdentityField(columnKey: string): PayrollIdentityField | null {
  switch (columnKey) {
    case "client":
      return "clientId";
    case "mg":
      return "employeeId";
    case "name":
      return "fullName";
    case "rest":
      return "restaurantName";
    default:
      return null;
  }
}

export function PayrollIdentityCell(props: {
  driverId: string;
  field: PayrollIdentityField;
  value: string;
  canEdit: boolean;
  tone?: { fill: string; text: string };
}) {
  const t = useTranslations("pages.payroll.cellEdit");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);
  const skipCommit = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(props.value);
  }, [props.value, focused]);

  const toneStyle = props.tone
    ? { background: props.tone.fill, color: props.tone.text, fontWeight: 700 }
    : undefined;

  if (!props.canEdit) {
    const shown = props.value.trim() ? props.value : "—";
    if (!toneStyle) return shown;
    return (
      <span className="inline-block rounded-md px-1.5 py-0.5" style={toneStyle}>
        {shown}
      </span>
    );
  }

  async function commit(next: string) {
    const trimmed = next.trim();
    if (trimmed === props.value.trim()) return;
    try {
      await savePayrollIdentity(props.driverId, props.field, trimmed);
      toast.success(t("saved"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    } catch (error) {
      setDraft(props.value);
      const message = error instanceof Error ? error.message : "";
      toast.error(cellError(message, t));
    }
  }

  return (
    <input
      value={draft}
      aria-label={props.field}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (skipCommit.current) {
          skipCommit.current = false;
          return;
        }
        void commit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          skipCommit.current = true;
          setDraft(props.value);
          event.currentTarget.blur();
        }
      }}
      className={INPUT}
      style={toneStyle}
    />
  );
}

export function PayrollOrderCell(props: {
  driverId: string;
  date: string;
  orders: number;
  overridden: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("pages.payroll.cellEdit");
  const queryClient = useQueryClient();
  const shown = props.overridden ? String(props.orders) : props.orders === 0 ? "" : String(props.orders);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  const skipCommit = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown, focused]);

  if (!props.canEdit) {
    if (props.overridden) return String(props.orders);
    return props.orders === 0 ? <span className="text-muted-foreground/50">–</span> : props.orders;
  }

  async function commit(next: string) {
    const trimmed = next.trim();
    if (trimmed === "") {
      if (!props.overridden) return;
      try {
        await savePayrollOrders(props.driverId, props.date, null);
        toast.success(t("saved"));
        await queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
      } catch (error) {
        setDraft(shown);
        toast.error(cellError(error instanceof Error ? error.message : "", t));
      }
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setDraft(shown);
      toast.error(t("invalidOrders"));
      return;
    }
    const orders = Number(trimmed);
    if (orders > 9999) {
      setDraft(shown);
      toast.error(t("invalidOrders"));
      return;
    }
    if (props.overridden && orders === props.orders) return;
    if (!props.overridden && orders === props.orders) return;
    try {
      await savePayrollOrders(props.driverId, props.date, orders);
      toast.success(t("saved"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
    } catch (error) {
      setDraft(shown);
      toast.error(cellError(error instanceof Error ? error.message : "", t));
    }
  }

  return (
    <input
      inputMode="numeric"
      value={draft}
      aria-label={props.date}
      placeholder="—"
      onMouseDown={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (skipCommit.current) {
          skipCommit.current = false;
          return;
        }
        void commit(draft);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          skipCommit.current = true;
          setDraft(shown);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        INPUT,
        "text-center tabular-nums",
        props.overridden && "border-t-orange-500",
      )}
    />
  );
}
