"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * One back affordance for every page header.
 *
 * Uses the browser's own history rather than a per-page parent link, so it
 * returns the operator to whatever they were actually looking at — a filtered
 * list, a day sheet, another driver — instead of a canned route. A deep link
 * has no history to pop, so that case falls back to the dashboard.
 */
export function AppBackButton({
  fallbackHref = "/dashboard",
  className,
}: {
  fallbackHref?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      title={t("back")}
      aria-label={t("back")}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground",
        "transition-colors hover:bg-accent hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.97]",
        className,
      )}
    >
      <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
      <span>{t("back")}</span>
    </button>
  );
}
