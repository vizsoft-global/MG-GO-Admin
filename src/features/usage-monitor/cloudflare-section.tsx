"use client";

import { useTranslations } from "next-intl";

import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { InfoNote } from "@/components/app/info-note";
import { SectionCard } from "@/components/app/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { CloudflareOverview } from "./cloudflare-actions";
import type { CloudflareMonthly, CloudflareWindowUsage } from "./cloudflare-forecast";
import { USAGE_WINDOWS, type UsageWindowKey } from "./usage-forecast";

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const USAGE_ROWS: ReadonlyArray<keyof CloudflareWindowUsage> = [
  "workerRequests",
  "workerCpuMs",
  "doRequests",
  "doWebsocketMessages",
  "doDurationGbs",
  "doRowsRead",
  "doRowsWritten",
  "r2ClassA",
  "r2ClassB",
];

const COST_LINES: ReadonlyArray<Exclude<keyof CloudflareMonthly, "total">> = [
  "base",
  "workerRequests",
  "workerCpu",
  "doRequests",
  "doDuration",
  "doRows",
  "r2Operations",
  "r2Storage",
];

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${NUMBER.format(bytes)} B`;
}

export function CloudflareSection({
  overview,
  forecasts,
}: {
  overview: CloudflareOverview;
  forecasts: Record<UsageWindowKey, CloudflareMonthly>;
}) {
  const t = useTranslations("pages.settings.usageMonitor");

  return (
    <>
      <InfoNote>{t("cloudflare.accountNote")}</InfoNote>
      {overview.unknown.length > 0 ? (
        <InfoNote>
          {t("cloudflare.unknown", {
            list: overview.unknown
              .map((key) => t(`cloudflare.rows.${key as keyof CloudflareWindowUsage}`))
              .join(", "),
          })}
        </InfoNote>
      ) : null}
      {overview.approximate.length > 0 ? (
        <InfoNote>{t("cloudflare.approximate", { list: overview.approximate.join(", ") })}</InfoNote>
      ) : null}
      {overview.failed.length > 0 ? (
        <InfoNote>
          {t("cloudflare.failed", {
            list: overview.failed.map((entry) => `${entry.dataset} (${entry.message})`).join("; "),
          })}
        </InfoNote>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
        <SectionCard title={t("cloudflare.title")} className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("usage.metric")}</TableHead>
                {USAGE_WINDOWS.map(({ key }) => (
                  <TableHead key={key} className={cn(TABLE_HEAD_CLASS, "text-end")}>
                    {t(`usage.${key}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {USAGE_ROWS.map((row) => (
                <TableRow key={row}>
                  <TableCell className="text-sm">{t(`cloudflare.rows.${row}`)}</TableCell>
                  {USAGE_WINDOWS.map(({ key }) => {
                    const value = overview.windows[key][row];
                    return (
                      <TableCell key={key} className="text-end text-sm tabular-nums">
                        {value == null ? (
                          <span className="text-muted-foreground">{t("cloudflare.notAvailable")}</span>
                        ) : (
                          NUMBER.format(value)
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {overview.storageBytes == null
              ? t("cloudflare.storageUnknown")
              : t("cloudflare.storage", {
                  size: formatBytes(overview.storageBytes),
                  objects: NUMBER.format(overview.storageObjects ?? 0),
                })}
          </p>
        </SectionCard>

        <SectionCard title={t("cloudflare.costTitle")} className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("forecast.line")}</TableHead>
                {USAGE_WINDOWS.map(({ key }) => (
                  <TableHead key={key} className={cn(TABLE_HEAD_CLASS, "text-end")}>
                    {t(`forecast.at.${key}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {COST_LINES.map((line) => (
                <TableRow key={line}>
                  <TableCell className="text-sm">{t(`cloudflare.lines.${line}`)}</TableCell>
                  {USAGE_WINDOWS.map(({ key }) => (
                    <TableCell key={key} className="text-end text-sm tabular-nums">
                      {USD.format(forecasts[key][line])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-sm font-semibold">{t("forecast.total")}</TableCell>
                {USAGE_WINDOWS.map(({ key }) => (
                  <TableCell key={key} className="text-end text-sm font-semibold tabular-nums">
                    {USD.format(forecasts[key].total)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
          <p className="mt-2 text-[10px] text-muted-foreground">{t("cloudflare.costNote")}</p>
        </SectionCard>
      </div>

      {overview.scripts.length > 0 ? (
        <SectionCard title={t("cloudflare.scripts.title")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("cloudflare.scripts.name")}</TableHead>
                {USAGE_WINDOWS.map(({ key }) => (
                  <TableHead key={key} className={cn(TABLE_HEAD_CLASS, "text-end")}>
                    {t(`usage.${key}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.scripts.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-mono text-xs">{row.name}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{NUMBER.format(row.h1)}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{NUMBER.format(row.h5)}</TableCell>
                  <TableCell className="text-end text-sm tabular-nums">{NUMBER.format(row.h24)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}
    </>
  );
}
