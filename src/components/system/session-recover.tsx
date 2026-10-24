"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearLocaleErrorRetries } from "@/lib/browser/locale-error-retry";

const RECOVER_KEY = "mghub-session-recover-tries";
const MAX_AUTO = 3;

function readTries(): number {
  if (typeof sessionStorage === "undefined") return 0;
  const n = Number(sessionStorage.getItem(RECOVER_KEY) ?? "0");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function bumpTries(): number {
  const next = readTries() + 1;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(RECOVER_KEY, String(next));
  }
  return next;
}

export function clearSessionRecoverTries(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(RECOVER_KEY);
}

export function SessionRecover() {
  const t = useTranslations("system.sessionRecover");
  const router = useRouter();
  const [manual, setManual] = useState(false);

  useEffect(() => {
    const n = bumpTries();
    if (n > MAX_AUTO) {
      setManual(true);
      return;
    }
    const id = window.setTimeout(() => {
      router.refresh();
    }, 700);
    return () => window.clearTimeout(id);
  }, [router]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("body")}</p>
        {manual ? (
          <Button
            type="button"
            className="mt-5 h-9 w-full"
            onClick={() => {
              clearSessionRecoverTries();
              window.location.reload();
            }}
          >
            <RefreshCw className="size-4" />
            {t("retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ClearLocaleErrorRetries() {
  useEffect(() => {
    clearLocaleErrorRetries();
    clearSessionRecoverTries();
  }, []);
  return null;
}
