"use client";

import { ExternalLink, Play, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  canCancelImportJob,
  canResumeImportJob,
  importJobProgress,
  type ImportJobStatus,
} from "./import-job";
import type { DriverImportJobSummary } from "./import-job-types";
import { useDriverImportJob } from "./driver-import-job-provider";

function jobPill(status: ImportJobStatus): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "running":
    case "applied":
      return "success";
    case "paused":
      return "warning";
    case "failed":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export function ImportJobHistory({
  onView,
}: {
  onView: (jobId: string) => void;
}) {
  const t = useTranslations("pages.drivers.import");
  const { jobs, resume, cancel } = useDriverImportJob();

  if (jobs.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noPreviousImports")}</p>;
  }

  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-muted/80">
          <tr>
            <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colFile")}</th>
            <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colStatus")}</th>
            <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colProgress")}</th>
            <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colWhen")}</th>
            <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <HistoryRow
              key={job.id}
              job={job}
              onView={onView}
              onResume={() => void resume(job.id)}
              onCancel={() => void cancel(job.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({
  job,
  onView,
  onResume,
  onCancel,
}: {
  job: DriverImportJobSummary;
  onView: (jobId: string) => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("pages.drivers.import");
  const { done, total } = importJobProgress(job.readyCount, job.remainingCount);
  const when = new Date(job.uploadedAt);
  const whenLabel = Number.isNaN(when.getTime())
    ? "—"
    : when.toLocaleString();

  return (
    <tr className="border-t border-border/60">
      <td className="max-w-[14rem] truncate px-2 py-1.5">{job.fileName}</td>
      <td className="px-2 py-1.5">
        <StatusPill variant={jobPill(job.status)} dot={false}>
          {t(`jobStatus.${job.status}`)}
        </StatusPill>
      </td>
      <td className="px-2 py-1.5 font-mono tabular-nums">
        {done}/{total}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground">{whenLabel}</td>
      <td className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 cursor-pointer rounded-md px-2 text-primary hover:bg-primary/10"
            onClick={() => onView(job.id)}
          >
            <ExternalLink className="me-1 h-3.5 w-3.5" />
            {t("viewImport")}
          </Button>
          {canResumeImportJob(job.status) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 cursor-pointer rounded-md px-2"
              onClick={onResume}
            >
              <Play className="me-1 h-3.5 w-3.5" />
              {t("resume")}
            </Button>
          ) : null}
          {canCancelImportJob(job.status) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 cursor-pointer rounded-md px-2 text-destructive hover:bg-destructive/10"
              onClick={onCancel}
            >
              <Trash2 className="me-1 h-3.5 w-3.5" />
              {t("cancelImport")}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
