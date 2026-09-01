"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { invalidateDriverCaches } from "../invalidate-driver-caches";
import {
  listDriverImportJobs,
  processDriverImportChunk,
  setDriverImportJobStatus,
  startDriverImportJob,
} from "../drivers-import-job-actions";
import { isActiveImportJob } from "./import-job";
import type { DriverImportJobSummary } from "./import-job-types";
import type { DriverImportPreviewRow } from "../types";
import { ImportJobBanner } from "./import-job-banner";

type StartPayload = {
  fileName: string;
  mapping: Record<string, string>;
  rows: DriverImportPreviewRow[];
  duplicateStrategy: "skip" | "update";
  approveImmediately: boolean;
};

type DriverImportJobContextValue = {
  jobs: DriverImportJobSummary[];
  activeJob: DriverImportJobSummary | null;
  runningJob: DriverImportJobSummary | null;
  start: (payload: StartPayload) => Promise<DriverImportJobSummary | null>;
  pause: (jobId: string) => Promise<void>;
  resume: (jobId: string) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
};

const DriverImportJobContext = createContext<DriverImportJobContextValue | null>(
  null,
);

export function useDriverImportJob() {
  const ctx = useContext(DriverImportJobContext);
  if (!ctx) {
    throw new Error("useDriverImportJob must be used within DriverImportJobProvider");
  }
  return ctx;
}

export function useDriverImportJobOptional() {
  return useContext(DriverImportJobContext);
}

export function DriverImportJobProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const canManage = can("drivers.manage");
  const t = useTranslations("pages.drivers.import");
  const queryClient = useQueryClient();
  const loopingRef = useRef(false);
  const loopJobRef = useRef<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: queryKeys.drivers.importJobs(),
    queryFn: async () => {
      const result = await listDriverImportJobs();
      if ("error" in result) throw new Error(result.error);
      return result.jobs;
    },
    enabled: canManage,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.some((job) => job.status === "running") ? 4_000 : 20_000;
    },
  });

  const jobs = jobsQuery.data ?? [];
  const runningJob = useMemo(
    () => jobs.find((job) => job.status === "running") ?? null,
    [jobs],
  );
  const activeJob = useMemo(
    () => jobs.find((job) => isActiveImportJob(job.status)) ?? null,
    [jobs],
  );

  const refreshJobs = useCallback(async (jobId?: string) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.drivers.importJobs() });
    if (jobId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.drivers.importJob(jobId) });
    }
  }, [queryClient]);

  const runLoop = useCallback(
    async (jobId: string) => {
      if (loopingRef.current) return;
      loopingRef.current = true;
      loopJobRef.current = jobId;
      try {
        while (loopJobRef.current === jobId) {
          const result = await processDriverImportChunk(jobId);
          if ("error" in result) {
            toast.error(t("importFailed"));
            break;
          }
          await refreshJobs(jobId);
          if (result.done) {
            await invalidateDriverCaches(queryClient);
            toast.success(
              t("importSuccess", {
                applied: result.job.appliedCount,
                skipped: result.job.skippedCount,
                approved: result.job.approvedCount,
              }),
            );
            break;
          }
          if (result.stopped) break;
        }
      } finally {
        loopingRef.current = false;
        loopJobRef.current = null;
      }
    },
    [queryClient, refreshJobs, t],
  );

  useEffect(() => {
    if (!canManage || !runningJob) return;
    if (loopingRef.current && loopJobRef.current === runningJob.id) return;
    void runLoop(runningJob.id);
  }, [canManage, runningJob, runLoop]);

  const start = useCallback(
    async (payload: StartPayload) => {
      const result = await startDriverImportJob(payload);
      if ("error" in result) {
        toast.error(
          result.error === "import_already_running"
            ? t("alreadyRunning")
            : t("importFailed"),
        );
        return null;
      }
      await refreshJobs(result.job.id);
      void runLoop(result.job.id);
      return result.job;
    },
    [refreshJobs, runLoop, t],
  );

  const pause = useCallback(
    async (jobId: string) => {
      loopJobRef.current = null;
      const result = await setDriverImportJobStatus(jobId, "pause");
      if ("error" in result) {
        toast.error(t("importFailed"));
        return;
      }
      await refreshJobs(jobId);
    },
    [refreshJobs, t],
  );

  const resume = useCallback(
    async (jobId: string) => {
      const result = await setDriverImportJobStatus(jobId, "resume");
      if ("error" in result) {
        toast.error(
          result.error === "import_already_running"
            ? t("alreadyRunning")
            : t("importFailed"),
        );
        return;
      }
      await refreshJobs(jobId);
      void runLoop(jobId);
    },
    [refreshJobs, runLoop, t],
  );

  const cancel = useCallback(
    async (jobId: string) => {
      loopJobRef.current = null;
      const result = await setDriverImportJobStatus(jobId, "cancel");
      if ("error" in result) {
        toast.error(t("importFailed"));
        return;
      }
      await refreshJobs(jobId);
      toast.success(t("cancelledToast"));
    },
    [refreshJobs, t],
  );

  const value = useMemo(
    () => ({ jobs, activeJob, runningJob, start, pause, resume, cancel }),
    [jobs, activeJob, runningJob, start, pause, resume, cancel],
  );

  return (
    <DriverImportJobContext.Provider value={value}>
      {canManage ? <ImportJobBanner /> : null}
      {children}
    </DriverImportJobContext.Provider>
  );
}
