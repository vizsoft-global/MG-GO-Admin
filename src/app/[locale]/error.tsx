"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSessionUnprovenError } from "@/lib/auth/session-unproven";
import {
  LOCALE_ERROR_MAX_RETRIES,
  bumpLocaleErrorRetries,
  clearLocaleErrorRetries,
} from "@/lib/browser/locale-error-retry";

function reloadPage() {
  clearLocaleErrorRetries();
  window.location.reload();
}

/**
 * Never paint `system.error` ("This page could not load / The server did not
 * answer in time"). That card is what operators reported after a signed-in
 * Auth hang. Auto-reset a few times, then offer a full reload.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("system.sessionRecover");
  const [manual, setManual] = useState(false);

  useEffect(() => {
    Sentry.captureException(error);
    const n = bumpLocaleErrorRetries();
    if (n > LOCALE_ERROR_MAX_RETRIES) {
      setManual(true);
      return;
    }
    const delay = isSessionUnprovenError(error) ? 400 : 700;
    const id = window.setTimeout(() => {
      reset();
    }, delay);
    return () => window.clearTimeout(id);
  }, [error, reset]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("body")}</p>
        {manual ? (
          <Button type="button" onClick={reloadPage} className="mt-5 h-9 w-full">
            <RefreshCw className="size-4" />
            {t("retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
