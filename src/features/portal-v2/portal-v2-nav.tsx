"use client";

import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

function initials(value: string | null | undefined): string {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The client top bar from Figma `7094:17619`: brand lockup on the start edge,
 * the two door pills in the middle, and the signed-in client on the end edge.
 * V2 keeps its own base path so the V1 portal is untouched.
 */
export function PortalV2Nav({
  projectLabel,
  previewProjectKey,
  updatedAt,
}: {
  projectLabel: string;
  previewProjectKey?: string;
  updatedAt?: string;
}) {
  const t = useTranslations("pages.clientPortalV2");
  const { fullName, email } = useAuth();
  const dashboardHref = previewProjectKey
    ? `/client-portal-v2/preview/${previewProjectKey}`
    : "/client-portal-v2";
  const employeesHref = previewProjectKey
    ? `/client-portal-v2/employees?project=${previewProjectKey}`
    : "/client-portal-v2/employees";
  const name = fullName ?? email ?? t("title");

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: "var(--accent-rust)" }}
          aria-hidden
        >
          {initials(projectLabel)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-5 text-[var(--text-primary)]">{projectLabel}</p>
          <p className="truncate text-xs leading-4 text-[var(--text-secondary)]">{t("riderPortalBy")}</p>
        </div>
      </div>

      <nav className="mx-auto flex items-center gap-1" aria-label={t("title")}>
        <Link
          href={dashboardHref}
          aria-current="page"
          className="h-9 rounded-lg px-4 text-sm font-medium leading-9"
          style={{ backgroundColor: "#fbeee9", color: "var(--accent-rust)" }}
        >
          {t("navDashboard")}
        </Link>
        <Link
          href={employeesHref}
          className="h-9 rounded-lg px-4 text-sm font-medium leading-9 text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-subtle)]"
        >
          {t("navEmployees")}
        </Link>
      </nav>

      <div className="flex items-center gap-3">
        {updatedAt ? (
          <p className="hidden text-xs sm:block" style={{ color: "var(--text-secondary)" }}>
            {t("updatedShort", { time: updatedAt })}
          </p>
        ) : null}
        <span className="hidden h-8 w-px bg-[var(--border-default)] sm:block" aria-hidden />
        <div className="flex items-center gap-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: "var(--selected-navy)" }}
            aria-hidden
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-4 text-[var(--text-primary)]">{name}</p>
            <p className="truncate text-[11px] leading-4 text-[var(--text-secondary)]">
              {[projectLabel, t("clientAdmin")].filter(Boolean).join(" · ")}
            </p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
        </div>
      </div>
    </header>
  );
}

export function portalInitials(value: string): string {
  return initials(value);
}

export function portalPillClass(active: boolean): string {
  return cn(
    "inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-medium",
    active
      ? "bg-[var(--selected-navy)] text-white"
      : "bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
  );
}
