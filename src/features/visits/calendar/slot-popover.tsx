"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

import { serviceColorVar } from "./colors";

export type SlotPopoverService = {
  key: string;
  label: string;
  count: number;
};

export function SlotPopover({
  open,
  onClose,
  title,
  subtitle,
  full,
  services,
  onOpenDay,
  openDayLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  full: boolean;
  services: SlotPopoverService[];
  onOpenDay: () => void;
  openDayLabel: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      className="w-[288px] rounded-xl border border-border bg-card p-3 text-start shadow-sm"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5 text-foreground">{title}</p>
          <p className="text-[10px] leading-4 text-muted-foreground">{subtitle}</p>
        </div>
        {full ? (
          <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--visit-cap-full)]/10 px-2 text-[10px] font-semibold text-[var(--visit-cap-full)] ring-1 ring-[var(--visit-cap-full)]/40">
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
          </span>
        ) : null}
      </div>
      <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto">
        {services.map((service) => (
          <li key={service.key} className="flex min-w-0 items-center gap-2 text-sm leading-5">
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", serviceColorVar(service.key, service.label))}
            />
            <span className="min-w-0 flex-1 truncate">{service.label}</span>
            <span className="shrink-0 tabular-nums">{service.count}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-border pt-2">
        <button
          type="button"
          onClick={onOpenDay}
          className={cn(
            "inline-flex h-9 w-full items-center justify-start gap-1.5 rounded-lg px-2 text-sm text-primary",
            "transition-colors duration-150 hover:bg-primary/10",
          )}
        >
          <ExternalLink className="size-5" aria-hidden />
          {openDayLabel}
        </button>
      </div>
    </div>
  );
}
