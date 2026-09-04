"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Catches server errors from every route under a locale, including the
 * dashboard layout's auth gate. Reaching this screen keeps the admin signed
 * in, which is the point: a failed auth round trip used to redirect to
 * /login and read as a logout.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("system.error");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex size-10 items-center justify-center rounded-lg bg-warning/10 text-warning">
          <TriangleAlert className="size-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("body")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("sessionSafe")}</p>
        <Button onClick={reset} className="mt-5 h-9 w-full">
          <RefreshCw className="size-4" />
          {t("retry")}
        </Button>
        {error.digest ? (
          <p className="mt-3 text-center text-[10px] text-muted-foreground">
            {t("reference", { digest: error.digest })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
