"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { History, PencilLine } from "lucide-react";

export type PayrollCellMenuState = {
  x: number;
  y: number;
  driverId: string;
  date: string;
};

export function PayrollCellMenu({
  state,
  onEdit,
  onHistory,
  onClose,
}: {
  state: PayrollCellMenuState | null;
  onEdit: () => void;
  onHistory: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.payroll.adjust");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  const left = Math.min(state.x, window.innerWidth - 180);
  const top = Math.min(state.y, window.innerHeight - 88);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-40 rounded-md border border-border bg-popover p-1 shadow-md"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-[11px] font-semibold text-primary hover:bg-primary/10"
        onClick={onEdit}
      >
        <PencilLine className="size-3.5" />
        {t("edit")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-[11px] font-semibold hover:bg-muted/50"
        onClick={onHistory}
      >
        <History className="size-3.5" />
        {t("viewHistory")}
      </button>
    </div>
  );
}
