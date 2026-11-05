"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The employee file a payroll row points at.
 *
 * Locale-less on purpose: `@/i18n/navigation`'s `Link` prepends the active
 * locale, so building `/${locale}/drivers/…` here would print `/en/en/drivers`.
 * `from=payroll` is what the employee page uses to send the operator back.
 */
export function payrollEmployeeHref(driverId: string): string {
  return `/drivers/${encodeURIComponent(driverId)}?from=payroll`;
}

/**
 * The trailing action cell every payroll table carries: open the rider's file.
 * The icon is always in the DOM (visible on hover/focus) so the column keeps one
 * width and the control is reachable by keyboard.
 */
export function PayrollRowLink({
  driverId,
  className,
  label,
}: {
  driverId: string | null | undefined;
  className?: string;
  /** Overrides the translated `Open employee` label. */
  label?: string;
}) {
  const t = useTranslations("pages.payroll.common");
  const text = label ?? t("openEmployee");

  if (!driverId) {
    return (
      <span className={cn("inline-flex size-7 items-center justify-center text-muted-foreground", className)}>
        <span aria-hidden>—</span>
      </span>
    );
  }

  return (
    <Link
      href={payrollEmployeeHref(driverId)}
      aria-label={text}
      title={text}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors",
        "hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary",
        "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
        className,
      )}
    >
      <ExternalLink className="size-3.5" />
      <span className="sr-only">{text}</span>
    </Link>
  );
}
