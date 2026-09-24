"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RequestFieldRow } from "@/features/requests/request-field-row";
import { cn } from "@/lib/utils";

export function FleetDetailRow({
  label,
  children,
  muted,
}: {
  label: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <RequestFieldRow label={label} muted={muted}>
      {children}
    </RequestFieldRow>
  );
}

export function FleetRecordDialog({
  open,
  onOpenChange,
  children,
  footer,
  scroll = true,
  frame = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer: ReactNode;
  scroll?: boolean;
  /** Request popups grow with the viewport. Fuel-fill and assignment dialogs stay on the default frame. */
  frame?: "default" | "viewport";
}) {
  const viewport = frame === "viewport";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className={cn(
          "w-[min(1200px,96vw)] overflow-visible px-5 py-4",
          viewport && "h-[min(920px,calc(100dvh-1.5rem))] max-w-none",
        )}
      >
        <div
          className={
            viewport
              ? "min-h-0 flex-1 space-y-3 overflow-y-auto pt-4"
              : scroll
                ? "max-h-[min(648px,calc(100dvh-8rem))] space-y-3 overflow-y-auto pt-4"
                : "space-y-3 pt-4"
          }
        >
          {children}
        </div>
        <div className="shrink-0">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}
