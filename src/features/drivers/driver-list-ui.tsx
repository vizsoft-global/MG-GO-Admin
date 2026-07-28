"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/dashboard/status-pill";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import {
  formatPhoneDisplay,
  isValidKuwaitPhoneDigits,
  phoneStorageToDigits,
} from "./driver-phone";
import type { DriverAccountStatus } from "./types";

export function formatDriverCodeDisplay(code: string): string {
  const trimmed = code.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function formatPhoneInternational(stored: string): string {
  const digits = phoneStorageToDigits(stored);
  if (!isValidKuwaitPhoneDigits(digits)) return formatPhoneDisplay(stored);
  return `+965 ${digits.slice(0, 4)} ${digits.slice(4)}`;
}

export function AccountStatusPill({
  status,
  label,
}: {
  status: DriverAccountStatus;
  label: string;
}) {
  return (
    <StatusPill variant={resolveStatusVariant(status)} dot={false}>
      {label}
    </StatusPill>
  );
}

export function AttendancePill({
  onDuty,
  onDutyLabel,
  offDutyLabel,
}: {
  onDuty: boolean;
  onDutyLabel: string;
  offDutyLabel: string;
}) {
  return (
    <StatusPill variant={onDuty ? "success" : "neutral"} dot>
      {onDuty ? onDutyLabel : offDutyLabel}
    </StatusPill>
  );
}

export function PasscodeCell({ passcode }: { passcode: string | null }) {
  const t = useTranslations("pages.drivers.passcode");
  const [revealed, setRevealed] = useState(false);

  if (!passcode) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const stopRowNav = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleCopy = async (e: React.MouseEvent) => {
    stopRowNav(e);
    try {
      await navigator.clipboard.writeText(passcode);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const handleToggleReveal = (e: React.MouseEvent) => {
    stopRowNav(e);
    setRevealed((v) => !v);
  };

  return (
    <div
      className="inline-flex items-center gap-0.5"
      data-no-row-nav
      onClick={stopRowNav}
      onKeyDown={stopRowNav}
    >
      <button
        type="button"
        onClick={handleToggleReveal}
        onKeyDown={stopRowNav}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-sm tabular-nums tracking-[0.2em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={revealed ? t("hide") : t("reveal")}
      >
        <span>{revealed ? passcode : "••••••"}</span>
        {revealed ? (
          <EyeOff className="h-3 w-3 opacity-60" />
        ) : (
          <Eye className="h-3 w-3 opacity-60" />
        )}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        onKeyDown={stopRowNav}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t("copyAria")}
      >
        <Copy className="h-3 w-3 opacity-60" />
      </button>
    </div>
  );
}

export function PartnerCell({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <span className="truncate text-sm text-foreground">{name}</span>
    </div>
  );
}

export function RestaurantsCell({ names }: { names: string[] }) {
  if (!names || names.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const visible = names.slice(0, 2);
  const extra = names.length - visible.length;
  const tooltipText = names.join(", ");
  return (
    <div
      className="flex min-w-0 max-w-[220px] flex-wrap items-center gap-1"
      title={tooltipText}
    >
      {visible.map((name) => (
        <span
          key={name}
          className="inline-flex max-w-full items-center truncate rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-foreground"
        >
          {name}
        </span>
      ))}
      {extra > 0 ? (
        <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
