"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Cloud,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppFormSection } from "@/components/app";
import {
  getStorageOverview,
  testStorageConnection,
  verifyCloudflareApiToken,
  type StorageOverview,
} from "@/features/settings/storage-actions";

type UploadFilter = "all" | "admin" | "driver";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function sourceBadgeVariant(
  via: string,
): "default" | "secondary" | "outline" {
  if (via === "admin") return "secondary";
  if (via === "driver_presigned" || via === "driver_proxy") return "default";
  return "outline";
}

function sourceLabel(
  via: string,
  t: ReturnType<typeof useTranslations<"pages.settings.storage">>,
): string {
  if (via === "admin") return t("recent.sourceAdmin");
  if (via === "driver_presigned") return t("recent.sourceDriverPresigned");
  if (via === "driver_proxy") return t("recent.sourceDriverProxy");
  return via;
}

export function StorageSettingsPanel() {
  const t = useTranslations("pages.settings.storage");
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadFilter, setUploadFilter] = useState<UploadFilter>("all");
  const [lastProbeKey, setLastProbeKey] = useState<string | null>(null);

  const loadOverview = useCallback(async (filter: UploadFilter) => {
    const result = await getStorageOverview(filter);
    if ("error" in result) {
      setError(result.error);
      return null;
    }
    setError(null);
    setOverview(result);
    return result;
  }, []);

  useEffect(() => {
    void loadOverview(uploadFilter).finally(() => setLoading(false));
  }, [loadOverview, uploadFilter]);

  const handleRefresh = () => {
    startTransition(async () => {
      await loadOverview(uploadFilter);
    });
  };

  const handleProbe = () => {
    startTransition(async () => {
      setLastProbeKey(null);
      const result = await testStorageConnection();
      if (result.ok) {
        if (result.key) setLastProbeKey(result.key);
        toast.success(
          result.key
            ? t("testSuccessDetail", { key: result.key })
            : t("testSuccess"),
        );
        await loadOverview(uploadFilter);
        return;
      }
      toast.error(
        result.error === "not_configured"
          ? t("errors.not_configured")
          : t("errors.connection_failed"),
      );
    });
  };

  const handleVerifyToken = () => {
    startTransition(async () => {
      const result = await verifyCloudflareApiToken();
      if (result.ok) {
        toast.success(
          t("verifyTokenSuccess", {
            status: result.status ?? result.message ?? "active",
          }),
        );
        return;
      }
      toast.error(
        result.error === "missing_cloudflare_token"
          ? t("errors.missing_cloudflare_token")
          : t("errors.verify_failed"),
      );
    });
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const configured = overview?.connection.configured ?? false;
  const stats = overview?.stats;
  const analytics = overview?.analytics;
  const maxExtBytes = stats?.byExtension[0]?.bytes ?? 1;
  const maxPrefixBytes = stats?.byPrefix[0]?.bytes ?? 1;
  const maxChartBytes =
    analytics && analytics.available
      ? Math.max(...analytics.dailySeries.map((p) => p.bytes), 1)
      : 1;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer rounded-lg"
          disabled={isPending}
          onClick={handleRefresh}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("refresh")}
        </Button>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {t("envNote")}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <AppFormSection
        title={t("connection.title")}
        description={t("connection.description")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={configured ? "default" : "destructive"}>
            {configured ? t("connection.configured") : t("connection.notConfigured")}
          </Badge>
          {overview?.connection.bucket ? (
            <span className="font-mono text-xs text-muted-foreground">
              {overview.connection.bucket}
            </span>
          ) : null}
        </div>
        {configured ? (
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("connection.accountId")}</dt>
              <dd className="font-mono text-xs">{overview?.connection.accountIdMasked}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("connection.endpoint")}</dt>
              <dd className="break-all font-mono text-xs">{overview?.connection.endpoint}</dd>
            </div>
          </dl>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer rounded-lg"
            disabled={isPending || !configured}
            onClick={handleProbe}
          >
            {t("connection.runProbe")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer rounded-lg"
            disabled={isPending || !configured}
            onClick={handleVerifyToken}
          >
            {t("connection.verifyToken")}
          </Button>
        </div>
        {lastProbeKey ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("probeResult", { key: lastProbeKey })}
          </p>
        ) : null}
      </AppFormSection>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <HardDrive className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("stats.totalObjects")}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {stats ? formatNumber(stats.totalCount) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <HardDrive className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("stats.totalSize")}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {stats ? formatBytes(stats.totalBytes) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("stats.classA")}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {analytics?.available
              ? formatNumber(analytics.classARequests)
              : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("stats.last30Days")}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("stats.classB")}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {analytics?.available
              ? formatNumber(analytics.classBRequests)
              : "—"}
          </p>
          {analytics?.available ? (
            <p className="text-[11px] text-muted-foreground">
              {t("stats.egress", { size: formatBytes(analytics.egressBytes) })}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("stats.last30Days")}</p>
          )}
        </div>
      </div>

      {analytics && !analytics.available ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted-foreground">
          {t("analytics.unavailable")}
        </div>
      ) : null}

      {overview?.statsError ? (
        <p className="text-sm text-destructive">{t("errors.list_failed")}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <AppFormSection title={t("breakdown.byType")} description="">
          {stats?.byExtension.length ? (
            <ul className="space-y-2">
              {stats.byExtension.map((row) => (
                <li key={row.ext} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-mono">{row.ext}</span>
                    <span className="text-muted-foreground">
                      {formatNumber(row.count)} · {formatBytes(row.bytes)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${Math.round((row.bytes / maxExtBytes) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("breakdown.empty")}</p>
          )}
        </AppFormSection>

        <AppFormSection title={t("breakdown.byPrefix")} description="">
          {stats?.byPrefix.length ? (
            <ul className="space-y-2">
              {stats.byPrefix.map((row) => (
                <li key={row.prefix} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-mono">{row.prefix}</span>
                    <span className="text-muted-foreground">
                      {formatNumber(row.count)} · {formatBytes(row.bytes)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${Math.round((row.bytes / maxPrefixBytes) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("breakdown.empty")}</p>
          )}
        </AppFormSection>
      </div>

      {analytics?.available && analytics.dailySeries.length > 0 ? (
        <AppFormSection title={t("chart.title")} description={t("chart.description")}>
          <div className="flex h-32 items-end gap-1">
            {analytics.dailySeries.map((point) => (
              <div
                key={point.date}
                className="group relative min-w-0 flex-1"
                title={`${point.date}: ${formatBytes(point.bytes)}`}
              >
                <div
                  className="mx-auto w-full max-w-3 rounded-t bg-primary/60 transition-colors group-hover:bg-primary"
                  style={{
                    height: `${Math.max(4, Math.round((point.bytes / maxChartBytes) * 100))}%`,
                  }}
                />
              </div>
            ))}
          </div>
        </AppFormSection>
      ) : null}

      <AppFormSection
        title={t("recent.title")}
        description={t("recent.description")}
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(["all", "admin", "driver"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={uploadFilter === f ? "default" : "outline"}
              className="cursor-pointer rounded-lg"
              onClick={() => setUploadFilter(f)}
            >
              {t(`recent.filter.${f}`)}
            </Button>
          ))}
        </div>
        {overview?.recentUploads.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">{t("recent.objectKey")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("recent.size")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("recent.type")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("recent.source")}</th>
                  <th className="pb-2 pr-3 font-medium">{t("recent.uploader")}</th>
                  <th className="pb-2 font-medium">{t("recent.at")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentUploads.map((row) => (
                  <tr key={row.id} className="border-b border-border/40">
                    <td className="max-w-[200px] truncate py-2 pr-3 font-mono text-xs">
                      {row.objectKey}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {row.sizeBytes != null ? formatBytes(row.sizeBytes) : "—"}
                    </td>
                    <td className="py-2 pr-3">{row.contentType ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={sourceBadgeVariant(row.uploadedVia)}>
                        {sourceLabel(row.uploadedVia, t)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{row.uploaderLabel ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(row.uploadedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("recent.empty")}</p>
        )}
      </AppFormSection>

      <AppFormSection
        title={t("driverApi.title")}
        description={t("driverApi.description")}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("driverApi.presign")}</li>
          <li>{t("driverApi.proxy")}</li>
          <li>{t("driverApi.mine")}</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{t("driverApi.handoff")}</p>
      </AppFormSection>
    </div>
  );
}
