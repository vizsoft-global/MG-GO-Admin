"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import {
  getGoogleMapsLoadFailure,
  loadGoogleMaps,
  type GoogleMapsLoadFailure,
} from "@/lib/google-maps/load";

export function GoogleMapsStatusBanner({ className }: { className?: string }) {
  const t = useTranslations("pages.restaurants");
  const [failure, setFailure] = useState<GoogleMapsLoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((api) => {
      if (cancelled) return;
      setFailure(api ? null : getGoogleMapsLoadFailure());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!failure) return null;

  if (failure === "missing_key") {
    return (
      <div
        className={
          className ??
          "rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
        }
      >
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("hints.googleKeyMissing")}</span>
        </p>
      </div>
    );
  }

  if (failure === "auth_failure") {
    return (
      <div
        className={
          className ??
          "rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        }
      >
        <p className="flex items-start gap-2 font-medium">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("hints.googleMapsAuthFailed")}</span>
        </p>
        <p className="mt-1.5 ps-5 text-[11px] leading-relaxed text-destructive/90">
          {t("hints.googleMapsReferrerFix")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        className ??
        "rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      }
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t("hints.googleMapsLoadFailed")}</span>
      </p>
    </div>
  );
}
