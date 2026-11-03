"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { signOut } from "@/features/auth/actions";
import { cn } from "@/lib/utils";

const PORTAL_INK = "#27273f";
const PORTAL_MUTED = "#5e5e72";
const PORTAL_RUST = "#a73c24";

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
 */
export function ClientPortalNav({
  projectLabel,
  previewProjectKey,
  updatedAt,
}: {
  projectLabel?: string;
  previewProjectKey?: string;
  updatedAt?: string;
}) {
  const t = useTranslations("pages.clientPortal");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { fullName, email } = useAuth();
  const [pending, startTransition] = useTransition();
  const onEmployees =
    pathname === "/client-portal/employees" || pathname.startsWith("/client-portal/employees/");
  const dashboardHref = previewProjectKey
    ? `/client-portal/preview/${previewProjectKey}`
    : "/client-portal";
  const employeesHref = previewProjectKey
    ? `/client-portal/employees?project=${previewProjectKey}`
    : "/client-portal/employees";
  const name = fullName ?? email ?? t("title");

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-[var(--portal-border)] bg-[var(--portal-canvas)] px-5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: PORTAL_RUST }}
          aria-hidden
        >
          {initials(projectLabel)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-5" style={{ color: PORTAL_INK }}>
            {projectLabel ?? t("title")}
          </p>
          <p className="truncate text-xs leading-4" style={{ color: PORTAL_MUTED }}>
            {t("riderPortalBy")}
          </p>
        </div>
      </div>

      <nav className="mx-auto flex items-center gap-1" aria-label={t("title")}>
        <button
          type="button"
          onClick={() => router.push(dashboardHref)}
          aria-current={!onEmployees}
          className={cn(
            "h-9 cursor-pointer rounded-lg px-4 text-sm font-medium transition-colors duration-150",
            onEmployees ? "hover:bg-[#faf8f7]" : "",
          )}
          style={
            onEmployees
              ? { color: PORTAL_INK }
              : { backgroundColor: "#fbeee9", color: PORTAL_RUST }
          }
        >
          {t("navDashboard")}
        </button>
        <button
          type="button"
          onClick={() => router.push(employeesHref)}
          aria-current={onEmployees}
          className={cn(
            "h-9 cursor-pointer rounded-lg px-4 text-sm font-medium transition-colors duration-150",
            onEmployees ? "" : "hover:bg-[#faf8f7]",
          )}
          style={
            onEmployees
              ? { backgroundColor: "#fbeee9", color: PORTAL_RUST }
              : { color: PORTAL_INK }
          }
        >
          {t("navEmployees")}
        </button>
      </nav>

      <div className="flex items-center gap-3">
        {updatedAt ? (
          <p className="hidden text-xs sm:block" style={{ color: PORTAL_MUTED }}>
            {t("updatedShort", { time: updatedAt })}
          </p>
        ) : null}
        <span className="hidden h-8 w-px bg-[var(--portal-border)] sm:block" aria-hidden />
        <div className="flex items-center gap-2">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: PORTAL_INK }}
            aria-hidden
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-4" style={{ color: PORTAL_INK }}>
              {name}
            </p>
            <p className="truncate text-[11px] leading-4" style={{ color: PORTAL_MUTED }}>
              {[projectLabel, t("clientAdmin")].filter(Boolean).join(" · ")}
            </p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-[var(--portal-muted)]" aria-hidden />
        </div>
        <button
          type="button"
          title={t("signOut")}
          aria-label={t("signOut")}
          disabled={pending}
          onClick={() => {
            startTransition(() => {
              void signOut(locale);
            });
          }}
          className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--portal-border)] bg-transparent transition-colors duration-150 hover:bg-[#faf8f7] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="size-4" style={{ color: PORTAL_MUTED }} aria-hidden />
        </button>
      </div>
    </header>
  );
}
