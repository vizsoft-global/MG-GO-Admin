"use client";

import { ExternalLink, Pause, Play, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import { importJobProgress } from "./import-job";
import { useDriverImportJob } from "./driver-import-job-provider";

export function ImportJobBanner() {
  const { activeJob, pause, resume, cancel } = useDriverImportJob();
  const t = useTranslations("pages.drivers.import");
  const pathname = usePathname();
  const router = useRouter();

  if (!activeJob) return null;

  const { done, total } = importJobProgress(
    activeJob.readyCount,
    activeJob.remainingCount,
  );
  const onDrivers = pathname.includes("/drivers");
  const running = activeJob.status === "running";

  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <StatusPill variant={running ? "success" : "warning"} dot>
            {running ? t("jobRunning") : t("jobPaused")}
          </StatusPill>
          <p className="truncate text-xs font-medium text-foreground">
            {activeJob.fileName}
          </p>
        </div>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          {t("importProgress", { done, total })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 cursor-pointer rounded-md px-2 text-primary hover:bg-primary/10"
          onClick={() => {
            if (onDrivers) {
              router.replace("/drivers?import=1");
              return;
            }
            router.push("/drivers?import=1");
          }}
        >
          <ExternalLink className="me-1.5 h-3.5 w-3.5" />
          {t("viewImport")}
        </Button>
        {running ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => void pause(activeJob.id)}
          >
            <Pause className="me-1.5 h-3.5 w-3.5" />
            {t("pause")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => void resume(activeJob.id)}
          >
            <Play className="me-1.5 h-3.5 w-3.5" />
            {t("resume")}
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="h-9 cursor-pointer rounded-md"
          onClick={() => void cancel(activeJob.id)}
        >
          <Trash2 className="me-1.5 h-3.5 w-3.5" />
          {t("cancelImport")}
        </Button>
      </div>
    </div>
  );
}
