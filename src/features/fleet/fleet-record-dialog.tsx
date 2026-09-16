"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RequestFieldRow } from "@/features/requests/request-field-row";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible px-5 py-4"
      >
        <div className="max-h-[min(648px,calc(100dvh-8rem))] space-y-3 overflow-y-auto pt-4">
          {children}
        </div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
