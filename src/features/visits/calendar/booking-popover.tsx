"use client";

import { useEffect } from "react";
import { Briefcase, CircleDot, Clock, Phone, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { avatarTintClass, initialsOf } from "@/features/visits/visit-status-utils";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type BookingPopoverStatus = "confirmed" | "checked_in" | "completed" | "no_show";

export type BookingPopoverVisit = {
  id: string;
  name: string;
  phone: string;
  serviceLabel: string;
  timeLabel: string;
  status: BookingPopoverStatus;
};

export type BookingPopoverLabels = {
  service: string;
  time: string;
  phone: string;
  status: string;
  checkIn: string;
  reschedule: string;
  close: string;
};

function badgeVariant(
  status: BookingPopoverStatus,
): "portal-blue" | "portal-green" | "portal-grey" | "portal-red" {
  switch (status) {
    case "confirmed":
      return "portal-blue";
    case "checked_in":
      return "portal-green";
    case "completed":
      return "portal-grey";
    case "no_show":
      return "portal-red";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "—";
  if (digits.length <= 4) return trimmed;
  const last4 = digits.slice(-4);
  let countryLen = 0;
  if (trimmed.startsWith("+")) {
    const preferred = digits.length - 8;
    countryLen = preferred >= 1 && preferred <= 3 ? preferred : Math.min(3, digits.length - 5);
    if (countryLen < 1) countryLen = 1;
    if (countryLen >= digits.length - 4) countryLen = Math.max(1, digits.length - 5);
  }
  const middle = "•".repeat(Math.max(digits.length - countryLen - 4, 1));
  const country = countryLen > 0 ? `+${digits.slice(0, countryLen)} ` : "";
  return `${country}${middle} ${last4}`;
}

export function BookingPopover({
  open,
  onClose,
  visit,
  statusLabel,
  canOperate,
  onCheckIn,
  onReschedule,
  detailHref,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  visit: BookingPopoverVisit | null;
  statusLabel: (status: string) => string;
  canOperate: boolean;
  onCheckIn: () => void;
  onReschedule: () => void;
  detailHref: string;
  labels: BookingPopoverLabels;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !visit) return null;

  const titleId = `visit-booking-${visit.id}`;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed end-3 top-16 z-50 w-[300px] rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={labels.close}
        className="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" aria-hidden />
      </button>
      <div className="flex items-center gap-2 pe-8">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            avatarTintClass(visit.name),
          )}
        >
          {initialsOf(visit.name)}
        </span>
        <Link
          id={titleId}
          href={detailHref}
          className="min-w-0 truncate text-sm font-semibold text-primary hover:underline"
        >
          {visit.name}
        </Link>
      </div>
      <dl className="mt-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Briefcase className="size-3.5 shrink-0" aria-hidden />
            {labels.service}
          </dt>
          <dd className="min-w-0 text-end text-sm text-foreground">{visit.serviceLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            {labels.time}
          </dt>
          <dd className="text-sm tabular-nums text-foreground">{visit.timeLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="size-3.5 shrink-0" aria-hidden />
            {labels.phone}
          </dt>
          <dd className="text-sm tabular-nums text-foreground">{maskPhone(visit.phone)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleDot className="size-3.5 shrink-0" aria-hidden />
            {labels.status}
          </dt>
          <dd>
            <Badge variant={badgeVariant(visit.status)}>{statusLabel(visit.status)}</Badge>
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="portal"
          className="h-9 flex-1 px-4"
          disabled={!canOperate}
          onClick={onCheckIn}
        >
          {labels.checkIn}
        </Button>
        <Button
          type="button"
          variant="portal-secondary"
          className="h-9 flex-1 px-4"
          disabled={!canOperate}
          onClick={onReschedule}
        >
          {labels.reschedule}
        </Button>
      </div>
    </div>
  );
}
