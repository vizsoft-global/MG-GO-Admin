"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";

const HEADER_BTN = "h-9 cursor-pointer px-3";

export function ClientPortalNav({
  projectLabel,
  previewProjectKey,
}: {
  projectLabel?: string;
  previewProjectKey?: string;
}) {
  const t = useTranslations("pages.clientPortal");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const onEmployees = pathname === "/client-portal/employees" || pathname.startsWith("/client-portal/employees/");
  const dashboardHref = previewProjectKey ? `/client-portal/preview/${previewProjectKey}` : "/client-portal";
  const employeesHref = previewProjectKey
    ? `/client-portal/employees?project=${previewProjectKey}`
    : "/client-portal/employees";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {projectLabel ? (
        <p className="me-1 text-sm font-semibold text-[var(--portal-ink)]">{projectLabel}</p>
      ) : null}
      <Button
        className={HEADER_BTN}
        variant={onEmployees ? "portal-secondary" : "portal"}
        onClick={() => router.push(dashboardHref)}
      >
        {t("navDashboard")}
      </Button>
      <Button
        className={HEADER_BTN}
        variant={onEmployees ? "portal" : "portal-secondary"}
        onClick={() => router.push(employeesHref)}
      >
        {t("navEmployees")}
      </Button>
      <Button
        variant="portal-neutral"
        className={HEADER_BTN}
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            void signOut(locale);
          });
        }}
      >
        {t("signOut")}
      </Button>
    </div>
  );
}
